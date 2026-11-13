import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ActionBar, ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Card } from '@/components/Card';
import { FormField } from '@/components/FormField';
import { PlaceSearchField } from '@/features/place/PlaceSearchField';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { formatFoundAt, type PublicItem, type SearchFilters } from '@/lib/items';
import { itemRepository } from '@/lib/publicItems';
import { searchInstitutions, openInstitution, type InstitutionItem } from '@/lib/institutionItems';
import { usePreview } from '@/lib/preview/PreviewProvider';

const initialFilters: SearchFilters = { query: '', period: 'all', place: '' };
const periods = [
  { value: 'all', label: '전체 기간' },
  { value: '7', label: '최근 7일' },
  { value: '30', label: '최근 30일' },
] as const;
const pageSize = 25;
type SearchItem = PublicItem | InstitutionItem;
type SearchState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  items: SearchItem[];
  visible: number;
  memberCursor?: string | null;
  agencyCursor?: string | null;
  memberNotice?: string;
  agencyNotice?: string;
};
const initialState: SearchState = { status: 'idle', items: [], visible: 0 };
const resultTime = (item: SearchItem) =>
  Date.parse('source' in item ? item.date + 'T00:00:00+09:00' : item.foundAt);

async function loadResults(
  filters: SearchFilters,
  previous: SearchState,
  searchTime: number,
): Promise<SearchState> {
  const rows = new Map(previous.items.map((item) => [item.id, item]));
  const target = previous.visible + pageSize;
  let { memberCursor, agencyCursor, memberNotice, agencyNotice } = previous;
  let status: SearchState['status'] = 'success';
  // 두 출처가 응답할 때까지 카드를 공개하지 않고, 넘치는 결과는 다음 더보기에 사용합니다.
  while (rows.size < target && (memberCursor !== null || agencyCursor !== null)) {
    const before = rows.size;
    const [member, agency] = await Promise.allSettled([
      memberCursor === null
        ? undefined
        : itemRepository.searchPage(filters, memberCursor, searchTime),
      agencyCursor === null ? undefined : searchInstitutions(filters, agencyCursor),
    ]);
    if (member.status === 'fulfilled' && member.value) {
      for (const item of member.value.items) rows.set(item.id, item);
      memberCursor = member.value.nextCursor;
      memberNotice = undefined;
    } else if (member.status === 'rejected') {
      memberNotice = '회원 습득물을 불러오지 못했어요.';
    }
    if (agency.status === 'fulfilled' && agency.value) {
      for (const item of agency.value.items) rows.set(item.id, item);
      agencyCursor = agency.value.nextCursor;
      agencyNotice = agency.value.notices.join(' ');
    } else if (agency.status === 'rejected') {
      agencyNotice = '기관 자료를 불러오지 못했어요. 다시 시도해 주세요.';
    }
    if (member.status === 'rejected' && agency.status === 'rejected' && !rows.size)
      status = 'error';
    if (member.status === 'rejected' || agency.status === 'rejected' || rows.size === before) break;
  }
  const items = [...rows.values()].sort(
    (a, b) => resultTime(b) - resultTime(a) || a.id.localeCompare(b.id),
  );
  return {
    status,
    items,
    visible: Math.min(target, items.length),
    memberCursor,
    agencyCursor,
    memberNotice,
    agencyNotice,
  };
}

export default function SearchScreen() {
  const { profile } = usePreview();
  const [filters, setFilters] = useState(initialFilters);
  const [draft, setDraft] = useState(initialFilters);
  const [conditions, setConditions] = useState(false);
  const [choosingPeriod, setChoosingPeriod] = useState(false);
  const [validation, setValidation] = useState('');
  const [state, setState] = useState(initialState);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchTime = useRef(0);
  const pending = useRef(false);
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!conditions) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setConditions(false);
      return true;
    });
    return () => subscription.remove();
  }, [conditions]);

  async function search(values = filters) {
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
    searchTime.current = Date.now();
    try {
      const result = await loadResults(values, initialState, searchTime.current);
      if (id === requestId.current) setState(result);
    } catch {
      if (id === requestId.current) setState({ ...initialState, status: 'error' });
    } finally {
      if (id === requestId.current) pending.current = false;
    }
  }
  async function showMore() {
    if (pending.current) return;
    const id = ++requestId.current;
    pending.current = true;
    setLoadingMore(true);
    try {
      const result = await loadResults(filters, state, searchTime.current);
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
  function openConditions(reset = false) {
    Keyboard.dismiss();
    setDraft(reset ? { ...initialFilters, query: filters.query } : filters);
    setChoosingPeriod(false);
    setValidation('');
    setConditions(true);
  }
  function back() {
    if (conditions) setConditions(false);
    else if (router.canGoBack()) router.back();
    else router.replace('/home');
  }
  const heading = (
    <>
      <FormField
        label="찾는 물품명·특징"
        placeholder="예: 검정 이어폰, 자동차 키"
        value={filters.query}
        onChangeText={(query) => {
          if (pending.current) return;
          setFilters((f) => ({ ...f, query }));
          setState(initialState);
          setValidation('');
        }}
        editable={state.status !== 'loading'}
        returnKeyType="search"
        onSubmitEditing={() => void search()}
        error={validation || undefined}
      />
      <ActionButton
        label="기간·장소 조건"
        variant="outline"
        onPress={state.status === 'loading' ? undefined : () => openConditions()}
      />
      {(filters.period !== 'all' || filters.place.trim()) && (
        <Text style={typography.body}>
          {periods.find((p) => p.value === filters.period)?.label} ·{' '}
          {filters.place.trim() || '전체 장소'}
        </Text>
      )}
      {state.status === 'idle' && (
        <>
          <View style={styles.intro}>
            <Icon name="search" />
            <Text style={typography.label}>어떤 물건을 찾고 있나요?</Text>
            <Text style={typography.body}>
              {'물품명이나 특징을 입력하면\n등록된 습득물을 찾아드려요.'}
            </Text>
          </View>
          <Text style={[typography.body, styles.hint]}>
            근처 탭에서는 주변 습득물을 지도에서 볼 수 있어요.
          </Text>
        </>
      )}
      {state.status === 'loading' && (
        <View style={styles.feedback} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.blue} />
          <Text style={typography.body}>회원과 기관의 습득물을 함께 찾고 있어요.</Text>
        </View>
      )}
      {state.status === 'error' && (
        <View style={styles.feedback}>
          <Text accessibilityRole="alert" style={typography.heading}>
            검색하지 못했어요
          </Text>
          <Text style={typography.body}>잠시 후 다시 시도해 주세요. 입력한 조건은 유지돼요.</Text>
          <ActionButton label="다시 시도" onPress={() => void search()} />
        </View>
      )}
      {state.status === 'success' && (
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={typography.heading}
        >
          총 습득물 {state.items.length.toLocaleString('ko-KR')}건
        </Text>
      )}
      {!!(state.memberNotice || state.agencyNotice) && (
        <Text accessibilityLiveRegion="polite" style={typography.body}>
          {[state.memberNotice, state.agencyNotice].filter(Boolean).join(' ')}
        </Text>
      )}
      {state.status === 'success' && !state.items.length && (
        <>
          <Text style={typography.body}>검색어를 줄이거나 기간·장소 조건을 넓혀 보세요.</Text>
          <ActionButton
            label="검색 조건 다시 설정"
            variant="outline"
            onPress={() => openConditions(true)}
          />
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
        <Header
          title={conditions ? '검색 조건' : '습득물 검색'}
          onBack={back}
          accountOrigin={conditions ? undefined : 'search'}
        />
        {conditions ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.stack}>
              <Text accessibilityRole="header" style={typography.heading}>
                검색 범위를 정해 주세요
              </Text>
              <FormField
                label="물품명·특징"
                value={draft.query}
                onChangeText={(query) => {
                  setDraft((f) => ({ ...f, query }));
                  setValidation('');
                }}
                error={validation || undefined}
              />
              <View style={styles.field}>
                <Text style={typography.label}>기간</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`기간: ${periods.find((p) => p.value === draft.period)?.label}`}
                  accessibilityState={{ expanded: choosingPeriod }}
                  onPress={() => setChoosingPeriod((v) => !v)}
                  style={styles.select}
                >
                  <Text style={[typography.body, styles.ink]}>
                    {periods.find((p) => p.value === draft.period)?.label}
                  </Text>
                </Pressable>
                {choosingPeriod &&
                  periods.map((p) => (
                    <Pressable
                      key={p.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: p.value === draft.period }}
                      onPress={() => {
                        setDraft((f) => ({ ...f, period: p.value }));
                        setChoosingPeriod(false);
                      }}
                      style={[styles.option, p.value === draft.period && styles.intro]}
                    >
                      <Text style={typography.label}>
                        {p.label}
                        {p.value === draft.period ? ' · 선택됨' : ''}
                      </Text>
                    </Pressable>
                  ))}
              </View>
              <PlaceSearchField
                label="장소"
                placeholder="전체 장소"
                value={draft.place}
                onChangeText={(place) => setDraft((f) => ({ ...f, place }))}
                returnKeyType="search"
                onSubmitEditing={() => void search(draft)}
              />
            </View>
          </ScrollView>
        ) : (
          <FlatList
            data={state.items.slice(0, state.visible)}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
            ListHeaderComponent={<View style={styles.stack}>{heading}</View>}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) =>
              'source' in item ? (
                <Card title={item.name} onPress={() => openInstitution(item)}>
                  {item.source} · 보관처 {item.storage}
                  {'\n'}
                  {item.dateLabel} {item.date} · {item.reference}
                  {'\n'}기관 원문 보기
                </Card>
              ) : (
                <Card
                  title={item.name}
                  onPress={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })}
                >
                  {item.location} · {formatFoundAt(item.foundAt).slice(5)}
                  {'\n'}
                  회원 등록 · {item.statusLabel ?? '보관 중'}
                </Card>
              )
            }
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
        )}
        <ActionBar>
          <ActionButton
            label={
              conditions
                ? '검색 결과 보기'
                : state.status === 'idle'
                  ? '습득물 검색'
                  : '다시 검색하기'
            }
            loading={state.status === 'loading'}
            onPress={() => void search(conditions ? draft : filters)}
          />
        </ActionBar>
        {!conditions && <BottomNavigation selected="home" />}
      </KeyboardAvoidingView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 24 },
  stack: { gap: 16, marginBottom: 16 },
  intro: { backgroundColor: colors.lightBlue, padding: 16, borderRadius: 12, gap: 8 },
  field: { gap: 8 },
  select: {
    minHeight: 52,
    padding: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  option: { padding: 16, backgroundColor: colors.white, borderRadius: 12 },
  ink: { color: colors.ink },
  hint: { fontSize: 12, lineHeight: 18 },
  feedback: { gap: 16, paddingVertical: 16 },
  separator: { height: 16 },
  footer: { marginTop: 16 },
});
