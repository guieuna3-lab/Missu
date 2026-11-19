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
import { itemRepository, type PublicItem, type SearchFilters } from '@/lib/items';
import {
  searchInstitutions,
  openInstitution,
  institutionTotal,
  type InstitutionTotal,
  type InstitutionItem,
} from '@/lib/institutionItems';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { distanceOf, sortResults, type SearchSort } from '@/lib/searchRank';
import { searchResults } from '@/lib/searchResults';
import { seoulDate } from './RangeCalendar';
import { SearchConditionsSheet } from './SearchConditionsSheet';
import { SortSheet, sortLabels } from './SortSheet';

const initialFilters: SearchFilters = { query: '', period: 'all', place: '' };
const pageSize = 25;
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
const resultTime = (item: SearchItem) =>
  Date.parse('source' in item ? item.date + 'T00:00:00+09:00' : item.foundAt);

async function loadResults(
  filters: SearchFilters,
  previous: SearchState,
  searchTime: number,
  onMemberTotal?: (total: number) => void,
  sort: SearchSort = 'recent',
): Promise<SearchState> {
  if (sort !== 'distance') {
    const page = await searchResults(filters, sort, previous.memberCursor ?? undefined);
    if (page.memberTotal !== undefined) onMemberTotal?.(page.memberTotal);
    // 서버의 전체 순서를 그대로 유지합니다. 더보기에서 앞 페이지를 재정렬하지 않습니다.
    const items = [...new Map([...previous.items, ...page.items].map((i) => [i.id, i])).values()];
    return {
      status: 'success',
      items,
      visible: items.length,
      memberTotal: page.memberTotal ?? previous.memberTotal,
      memberCursor: page.nextCursor,
      agencyCursor: null,
      agencyNotice: page.notices?.join(' ') || undefined,
    };
  }
  const rows = new Map(previous.items.map((item) => [item.id, item]));
  const target = previous.visible + pageSize;
  let { memberCursor, agencyCursor, memberNotice, agencyNotice, memberTotal } = previous;
  const agencyPageIssues = new Set(previous.agencyPageIssues);
  let status: SearchState['status'] = 'success';
  // 두 출처가 응답할 때까지 카드를 공개하지 않고, 넘치는 결과는 다음 더보기에 사용합니다.
  while (rows.size < target && (memberCursor !== null || agencyCursor !== null)) {
    const before = rows.size;
    const [member, agency] = await Promise.allSettled([
      memberCursor === null
        ? undefined
        : itemRepository.searchPage(filters, memberCursor, searchTime).then((page) => {
            if (page.total !== undefined) onMemberTotal?.(page.total);
            return page;
          }),
      agencyCursor === null ? undefined : searchInstitutions(filters, agencyCursor),
    ]);
    if (member.status === 'fulfilled' && member.value) {
      for (const item of member.value.items) rows.set(item.id, item);
      memberCursor = member.value.nextCursor;
      memberTotal ??= member.value.total;
      memberNotice = undefined;
    } else if (member.status === 'rejected') {
      memberNotice = '회원 습득물을 불러오지 못했어요.';
    }
    if (agency.status === 'fulfilled' && agency.value) {
      for (const item of agency.value.items) rows.set(item.id, item);
      // 넘어간 페이지에서 누락된 자료는 뒤 페이지가 성공해도 누락된 상태입니다.
      if (agency.value.nextCursor && agency.value.nextCursor === agencyCursor) {
        agencyNotice = agency.value.notices.join(' ');
      } else {
        for (const notice of agency.value.notices) agencyPageIssues.add(notice);
        agencyNotice = undefined;
      }
      agencyCursor = agency.value.nextCursor;
    } else if (agency.status === 'rejected') {
      agencyNotice = '기관 자료를 불러오지 못했어요. 다시 시도해 주세요.';
    }
    if (member.status === 'rejected' && agency.status === 'rejected' && !rows.size)
      status = 'error';
    // 저장 목록의 마지막 페이지가 짧아도 첫 화면을 먼저 표시하고 원본 추가 조회는 더보기에서 진행합니다.
    const savedPage =
      agency.status === 'fulfilled' &&
      (agency.value?.verifiedPage || agency.value?.items.some((item) => item.lastVerifiedOn));
    if (
      member.status === 'rejected' ||
      agency.status === 'rejected' ||
      rows.size === before ||
      savedPage
    )
      break;
  }
  const items = [...rows.values()].sort(
    (a, b) => resultTime(b) - resultTime(a) || a.id.localeCompare(b.id),
  );
  return {
    status,
    items,
    visible: Math.min(target, items.length),
    memberCursor,
    memberTotal,
    agencyCursor,
    memberNotice,
    agencyNotice,
    agencyPageIssues: [...agencyPageIssues],
  };
}

export default function SearchScreen() {
  const { profile } = usePreview();
  const [filters, setFilters] = useState(initialFilters);
  const [conditions, setConditions] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [sort, setSort] = useState<SearchSort>('recent');
  const [sortLoading, setSortLoading] = useState(false);
  const [today] = useState(() => seoulDate());
  const [validation, setValidation] = useState('');
  const [state, setState] = useState(initialState);
  const [loadingMore, setLoadingMore] = useState(false);
  const [countFilters, setCountFilters] = useState<SearchFilters | null>(null);
  const [agencyCount, setAgencyCount] = useState<InstitutionTotal | null>(null);
  useEffect(() => {
    if (!countFilters) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const reply = await institutionTotal(countFilters!, controller.signal);
        if (controller.signal.aborted) return;
        setAgencyCount(reply);
        // 검색 시점의 보관 확인 건수를 고정합니다. 새로 검색할 때 최신 수를 읽습니다.
        if (reply.confirmedTotal !== undefined || reply.lastComplete) return;
        if (reply.status === 'counting')
          timer = setTimeout(
            () => void check(),
            reply.refreshAfterMs ?? (reply.progress ? 60000 : 3500),
          );
        else if (reply.status === 'unavailable') timer = setTimeout(() => void check(), 120000);
      } catch {
        if (!controller.signal.aborted) {
          setAgencyCount({ status: 'unavailable', total: null });
          timer = setTimeout(() => void check(), 120000);
        }
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [countFilters]);
  const searchTime = useRef(0);
  const pending = useRef(false);
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );
  /** 좌표가 필요한 가까운 순만 기존 위치 조회를 추가로 진행합니다. */
  const loadForSort = useCallback(async (base: SearchState, values: SearchFilters) => {
    if (pending.current || base.status !== 'success') return;
    const id = ++requestId.current;
    pending.current = true;
    setSortLoading(true);
    let current = base;
    try {
      for (
        let round = 0;
        round < 4 &&
        current.items.length < 100 &&
        (current.memberCursor !== null || current.agencyCursor !== null);
        round++
      ) {
        const next = await loadResults(values, current, searchTime.current, undefined, 'distance');
        if (next.items.length === current.items.length) break;
        current = next;
      }
      if (id === requestId.current) setState(current);
    } catch {
      // 더 불러오지 못해도 이미 받은 결과로 정렬합니다.
    } finally {
      if (id === requestId.current) {
        pending.current = false;
        setSortLoading(false);
      }
    }
  }, []);
  const search = useCallback(
    async (values: SearchFilters, nextSort: SearchSort) => {
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
      setAgencyCount(null);
      setCountFilters(
        values.period === 'custom' && values.to && values.to < today ? null : { ...values },
      );
      searchTime.current = Date.now();
      let loaded: SearchState | undefined;
      try {
        const result = await loadResults(
          values,
          initialState,
          searchTime.current,
          (memberTotal) => {
            if (id === requestId.current) setState((s) => ({ ...s, memberTotal }));
          },
          nextSort,
        );
        if (id === requestId.current) {
          setState(result);
          loaded = result;
        }
      } catch {
        if (id === requestId.current) setState({ ...initialState, status: 'error' });
      } finally {
        if (id === requestId.current) pending.current = false;
      }
      if (loaded && nextSort === 'distance' && values.near) void loadForSort(loaded, values);
    },
    [today, loadForSort],
  );
  async function showMore() {
    if (pending.current) return;
    const id = ++requestId.current;
    pending.current = true;
    setLoadingMore(true);
    try {
      const result = await loadResults(filters, state, searchTime.current, undefined, sort);
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
  const hasMore = state.memberCursor !== null || state.agencyCursor !== null;
  const displayed = sort === 'distance' ? sortResults(state.items, sort, filters) : state.items;
  // 직접 고른 기간이 오늘 전에 끝나면 기관 합계가 끝일을 반영하지 못해 건수를 세지 않습니다.
  const endsBeforeToday = filters.period === 'custom' && !!filters.to && filters.to < today;
  const snapshot =
    agencyCount?.status === 'complete' || agencyCount?.confirmedTotal === undefined
      ? agencyCount?.lastComplete
      : undefined;
  const institutions = agencyCount?.confirmedTotal ?? agencyCount?.total;
  const confirmedCount =
    snapshot?.total ??
    (state.memberTotal !== undefined && institutions != null
      ? state.memberTotal + institutions
      : null);
  // 목록과 건수는 따로 도착하므로 검색을 시작한 시점부터 건수 상태를 표시합니다.
  let countLabel = '확인된 습득물 건수 조회 중';
  if (confirmedCount !== null)
    countLabel = '확인된 습득물 ' + confirmedCount.toLocaleString('ko-KR') + '건';
  else if (agencyCount?.status === 'unavailable' || state.memberNotice)
    countLabel = '습득물 건수를 불러오지 못했어요';
  else if (agencyCount?.status === 'counting') countLabel = '확인된 습득물 집계 중';
  if (endsBeforeToday) countLabel = '직접 고른 기간의 습득물';
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
            disabled={state.status === 'loading' || loadingMore || sortLoading}
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
            {(snapshot?.policeIncluded ?? agencyCount.policeIncluded)
              ? '미슈 · 한성대 · 포털기관(지하철·공항·상점 등) · 경찰 합계'
              : '미슈 · 한성대 · 포털기관(지하철·공항·상점 등) 합계'}
            {snapshot &&
              ' · ' +
                new Date(snapshot.checkedAt).toLocaleDateString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                }) +
                ' 기준'}
          </Text>
        )}
      {!!(state.memberNotice || state.agencyNotice || state.agencyPageIssues?.length) && (
        <Text accessibilityLiveRegion="polite" style={typography.body}>
          {[state.memberNotice, ...(state.agencyPageIssues ?? []), state.agencyNotice]
            .filter(Boolean)
            .join(' ')}
        </Text>
      )}
      {sort === 'distance' && state.items.length > 0 && hasMore && (
        <Text style={[typography.body, styles.sortNote]}>
          {`앞쪽 ${state.items.length}건 중에서 ${sortLabels[sort]}으로 정렬했어요. 더 불러오면 다시 정렬해요.`}
        </Text>
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
            loading={state.status === 'loading' || sortLoading}
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
              void search(filters, next);
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
