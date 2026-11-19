import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ActionBar, ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { FormField } from '@/components/FormField';
import { Header } from '@/components/Header';
import { RecentItemRow } from '@/components/ItemRow';
import { ItemThumb } from '@/components/ItemThumb';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { type PublicItem, type SearchFilters } from '@/lib/items';
import { openInstitution, type InstitutionItem } from '@/lib/institutionItems';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { distanceOf, type SearchSort } from '@/lib/searchRank';
import { searchResults, searchCount, type SearchCount } from '@/lib/searchResults';
import { SearchConditionsSheet } from './SearchConditionsSheet';
import { SortSheet, sortLabels } from './SortSheet';

const initialFilters: SearchFilters = { query: '', period: 'all', place: '' };
const popular = ['지갑', '이어폰', '휴대폰', '카드', '키링', '가방'];
type SearchItem = PublicItem | InstitutionItem;
type SearchState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  items: SearchItem[];
  visible: number;
  memberTotal?: number;
  memberCursor?: string | null;
  agencyCursor?: string | null;
  memberNotice?: string;
  agencyNotice?: string;
  agencyPageIssues?: string[];
};
const initialState: SearchState = { status: 'idle', items: [], visible: 0 };
async function loadResults(
  filters: SearchFilters,
  previous: SearchState,
  sort: SearchSort,
): Promise<SearchState> {
  const page = await searchResults(filters, sort, previous.memberCursor ?? undefined);
  // 모든 정렬은 서버가 전체 후보에서 결정합니다. 앞 페이지의 순서를 바꾸지 않습니다.
  const items = [
    ...new Map([...previous.items, ...page.items].map((item) => [item.id, item])).values(),
  ];
  return {
    status: 'success',
    items,
    visible: items.length,
    memberCursor: page.nextCursor,
    agencyCursor: null,
    agencyNotice: page.notices?.join(' ') || undefined,
  };
}

export default function SearchScreen() {
  const { profile } = usePreview();
  const [filters, setFilters] = useState(initialFilters);
  const [conditions, setConditions] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [sort, setSort] = useState<SearchSort>('recent');
  const [validation, setValidation] = useState('');
  const [state, setState] = useState(initialState);
  const [loadingMore, setLoadingMore] = useState(false);
  const [countFilters, setCountFilters] = useState<SearchFilters | null>(null);
  const [agencyCount, setAgencyCount] = useState<SearchCount | null>(null);
  const [countError, setCountError] = useState(false);
  useEffect(() => {
    if (!countFilters) return;
    const controller = new AbortController();
    void searchCount(countFilters, controller.signal)
      .then((reply) => {
        if (!controller.signal.aborted) setAgencyCount(reply);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCountError(true);
      });
    return () => controller.abort();
  }, [countFilters]);
  const pending = useRef(false);
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );
  const search = useCallback(
    async (values: SearchFilters, nextSort: SearchSort, sortOnly = false) => {
      if (pending.current) return;
      if (!values.query.trim()) {
        setValidation('찾는 물품명이나 특징을 입력해 주세요.');
        return;
      }
      pending.current = true;
      const id = ++requestId.current;
      Keyboard.dismiss();
      setFilters(values);
      setConditions(false);
      setValidation('');
      setState({ ...initialState, status: 'loading' });
      // 정렬만 바뀌면 동일한 건수를 유지합니다. 새 조건·다시 검색에서만 갱신합니다.
      if (!sortOnly) {
        setAgencyCount(null);
        setCountError(false);
        setCountFilters({ ...values });
      }
      try {
        const result = await loadResults(values, initialState, nextSort);
        if (id === requestId.current) setState(result);
      } catch {
        if (id === requestId.current) setState({ ...initialState, status: 'error' });
      } finally {
        if (id === requestId.current) pending.current = false;
      }
    },
    [],
  );
  async function showMore() {
    if (pending.current) return;
    const id = ++requestId.current;
    pending.current = true;
    setLoadingMore(true);
    try {
      const result = await loadResults(filters, state, sort);
      if (id === requestId.current) setState(result);
    } catch {
      if (id === requestId.current)
        setState((previous) => ({
          ...previous,
          agencyNotice: '다음 물품을 불러오지 못했어요. 다시 시도해 주세요.',
        }));
    } finally {
      if (id === requestId.current) {
        pending.current = false;
        setLoadingMore(false);
      }
    }
  }
  function openConditions() {
    Keyboard.dismiss();
    setValidation('');
    setConditions(true);
  }
  function applyConditions(next: SearchFilters) {
    setConditions(false);
    // 기준 좌표가 없어지면 가까운 순을 쓸 수 없어 최신순으로 돌아갑니다.
    if (!next.near && sort === 'distance') setSort('recent');
    if (next.query.trim()) void search(next, !next.near && sort === 'distance' ? 'recent' : sort);
    else setFilters(next);
  }
  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }
  const conditionCount =
    (filters.period !== 'all' ? 1 : 0) + (filters.place || filters.near ? 1 : 0);
  const displayed = state.items;
  const confirmedCount = agencyCount?.total ?? null;
  const countLabel =
    confirmedCount !== null
      ? '확인된 습득물 ' + confirmedCount.toLocaleString('ko-KR') + '건'
      : countError
        ? '습득물 건수를 불러오지 못했어요'
        : '확인된 습득물 건수 조회 중';
  const heading = (
    <>
      <FormField
        label="찾는 물품명·특징"
        placeholder="예: 검정 이어폰, 자동차 키"
        value={filters.query}
        onChangeText={(query) => {
          if (pending.current) return;
          setFilters((f) => ({ ...f, query }));
          setCountFilters(null);
          setAgencyCount(null);
          setState(initialState);
          setValidation('');
        }}
        editable={state.status !== 'loading'}
        returnKeyType="search"
        onSubmitEditing={() => void search(filters, sort)}
        error={validation || undefined}
      />
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`기간 · 장소 조건${conditionCount ? `, ${conditionCount}개 적용됨` : ''}, 바꾸기`}
          disabled={state.status === 'loading'}
          onPress={openConditions}
          style={[styles.filter, conditionCount > 0 && styles.filterOn]}
        >
          <Icon name="info-date" size={15} tintColor={conditionCount ? colors.blue : colors.body} />
          <Text style={[styles.filterText, conditionCount > 0 && styles.filterTextOn]}>
            기간 · 장소
          </Text>
          {conditionCount > 0 && <Text style={styles.filterCount}>{conditionCount}</Text>}
        </Pressable>
        {state.status !== 'idle' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`정렬: ${sortLabels[sort]}, 바꾸기`}
            disabled={state.status === 'loading' || loadingMore}
            onPress={() => setSorting(true)}
            style={styles.sortButton}
          >
            <Text style={styles.sortText}>{sortLabels[sort]}</Text>
            <Text style={styles.sortCaret}>▾</Text>
          </Pressable>
        )}
      </View>
      {state.status === 'idle' && (
        <>
          <Text style={styles.sectionTitle}>자주 찾는 물건</Text>
          <View style={styles.popular}>
            {popular.map((label) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={`${label} 검색`}
                onPress={() => {
                  const next = { ...filters, query: label };
                  setFilters(next);
                  void search(next, sort);
                }}
                style={({ pressed }) => [styles.popularTile, pressed && styles.pressed]}
              >
                <ItemThumb name={label} size={44} />
                <Text style={styles.popularText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="근처에서 찾기, 잃어버린 곳 주변 습득물을 지도로 보기"
            onPress={() => router.push('/nearby')}
            style={({ pressed }) => [styles.nearCard, pressed && styles.pressed]}
          >
            <View style={styles.nearIcon}>
              <Icon name="info-place" size={24} tintColor="#12A150" />
            </View>
            <View style={styles.nearText}>
              <Text style={styles.nearTitle}>근처에서 찾기</Text>
              <Text style={styles.nearSub}>잃어버린 곳 주변 습득물을 지도로 봐요</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </>
      )}
      {state.status === 'loading' && confirmedCount === null && (
        <View style={styles.feedback} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.blue} />
          <Text style={typography.body}>습득물을 찾고 있어요.</Text>
        </View>
      )}
      {state.status === 'error' && (
        <View style={styles.feedback}>
          <Text accessibilityRole="alert" style={typography.heading}>
            검색하지 못했어요
          </Text>
          <Text style={typography.body}>잠시 후 다시 시도해 주세요. 입력한 조건은 유지돼요.</Text>
          <ActionButton label="다시 시도" onPress={() => void search(filters, sort)} />
        </View>
      )}
      {state.status !== 'idle' && (
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={typography.heading}
        >
          {countLabel}
        </Text>
      )}
      {(state.status === 'success' || state.status === 'loading') &&
        confirmedCount !== null &&
        agencyCount && (
          <Text style={typography.body}>
            미슈 · 한성대 · 포털기관(지하철·공항·상점 등) · 경찰의 확인된 자료
          </Text>
        )}
      {!!(state.memberNotice || state.agencyNotice || state.agencyPageIssues?.length) && (
        <Text accessibilityLiveRegion="polite" style={typography.body}>
          {[state.memberNotice, ...(state.agencyPageIssues ?? []), state.agencyNotice]
            .filter(Boolean)
            .join(' ')}
        </Text>
      )}
      {!!agencyCount?.notices.length && (
        <Text style={typography.body}>{agencyCount.notices.join(' ')}</Text>
      )}
      {state.status === 'loading' && confirmedCount !== null && (
        <Text style={typography.body}>목록을 불러오는 중…</Text>
      )}
      {state.status === 'success' && !state.items.length && (
        <>
          <Text style={typography.body}>검색어를 줄이거나 기간·장소 조건을 넓혀 보세요.</Text>
          <ActionButton label="검색 조건 다시 설정" variant="outline" onPress={openConditions} />
        </>
      )}
    </>
  );
  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Header title="습득물 검색" onBack={back} accountOrigin="search" />
        <FlatList
          data={displayed}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          ListHeaderComponent={<View style={styles.stack}>{heading}</View>}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item, index }) => {
            const distance = sort === 'distance' ? distanceOf(item, filters.near) : undefined;
            const unknownStart =
              sort === 'distance' &&
              distance === undefined &&
              (index === 0 || distanceOf(displayed[index - 1], filters.near) !== undefined);
            return (
              <View>
                {unknownStart && <Text style={styles.divider}>위치 정보가 없는 물품</Text>}
                <RecentItemRow
                  item={item}
                  distanceM={distance}
                  onPress={() =>
                    'source' in item
                      ? openInstitution(item)
                      : router.push({ pathname: '/items/[id]', params: { id: item.id } })
                  }
                />
              </View>
            );
          }}
          ListFooterComponent={
            state.status === 'success' ? (
              <View>
                {(state.visible < state.items.length ||
                  state.memberCursor !== null ||
                  state.agencyCursor !== null) && (
                  <ActionButton
                    label="습득물 더보기"
                    variant="outline"
                    loading={loadingMore}
                    onPress={() => void showMore()}
                  />
                )}
                {state.items.length > 0 && (
                  <Text style={[typography.body, styles.footer]}>
                    공개 정보는 누구나 볼 수 있어요.
                    {!profile && '\n회원 등록 물품은 로그인 후 반환을 요청할 수 있어요.'}
                  </Text>
                )}
              </View>
            ) : undefined
          }
        />
        <ActionBar>
          <ActionButton
            label={state.status === 'idle' ? '습득물 검색' : '다시 검색하기'}
            loading={state.status === 'loading'}
            onPress={() => void search(filters, sort)}
          />
        </ActionBar>
        <BottomNavigation selected="home" />
        {conditions && (
          <SearchConditionsSheet
            value={filters}
            onClose={() => setConditions(false)}
            onApply={applyConditions}
          />
        )}
        {sorting && (
          <SortSheet
            value={sort}
            query={filters.query}
            nearLabel={filters.near?.label}
            onClose={() => setSorting(false)}
            onChange={(next) => {
              setSorting(false);
              if (pending.current || next === sort) return;
              setSort(next);
              void search(filters, next, true);
            }}
          />
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 24 },
  stack: { gap: 16, marginBottom: 16 },
  feedback: { gap: 16, paddingVertical: 16 },
  separator: { height: 8 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    maxWidth: '100%',
  },
  filterOn: { borderColor: colors.blue, backgroundColor: colors.lightBlue },
  filterText: { ...typography.label, fontSize: 13, color: '#4E5968' },
  filterTextOn: { color: colors.blue, fontWeight: '700' },
  filterCount: { ...typography.label, fontSize: 12, color: colors.body },
  // 조건 탭과 같은 높이·세로 가운데로 맞춥니다.
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingLeft: 10,
  },
  sortText: { ...typography.label, fontSize: 13, fontWeight: '700' },
  sortCaret: { ...typography.label, fontSize: 11, color: colors.body },
  sortNote: { fontSize: 12, lineHeight: 18, color: colors.muted },
  sectionTitle: { ...typography.label, fontSize: 15, fontWeight: '700', marginTop: 4 },
  popular: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  popularTile: {
    width: '31.5%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 8,
    paddingTop: 14,
    paddingBottom: 12,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  popularText: { ...typography.label, fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  nearCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  nearIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F7EE',
  },
  nearText: { flex: 1, gap: 2 },
  nearTitle: { ...typography.label, fontSize: 14, fontWeight: '700' },
  nearSub: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  chevron: { fontSize: 22, lineHeight: 24, color: colors.divider },
  divider: {
    ...typography.body,
    fontSize: 12,
    textAlign: 'center',
    color: colors.muted,
    marginBottom: 8,
  },
  footer: { marginTop: 16 },
});
