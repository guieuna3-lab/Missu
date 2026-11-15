import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { TextLink } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { formatFoundAt } from '@/lib/items';
import { nearbyInstitutions, openInstitution, type InstitutionItem } from '@/lib/institutionItems';
import { readDeviceLocation } from './deviceLocation';
import { StreetMap } from './StreetMap';
import { campus, mapApi, nearbyMembers, type MapItem, type Coordinates } from './mapData';
import { MapIcon, mapArt } from './mapArt';
import { categories, defaultFilters, radii, type NearbyFilters } from './nearbyItems';
import { Chips, FilterSheet, LocationDialog } from './NearbyOptions';
import { NearbySearch } from './NearbySearch';

type NearbyRow = MapItem & { institution?: InstitutionItem };
function openDetail(item: NearbyRow) {
  if (item.institution) return openInstitution(item.institution);
  router.push({ pathname: '/items/[id]', params: { id: item.id } });
}

function ItemRow({ item }: { item: NearbyRow }) {
  const date = formatFoundAt(item.foundAt).slice(5, 10);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name} 상세 보기, ${item.foundLocation.label}, ${item.distanceM}m`}
      onPress={() => openDetail(item)}
      style={styles.item}
    >
      <MapIcon
        source={
          item.category === 'ELECTRONICS'
            ? mapArt.rows.buds
            : item.category === 'WALLET_BAG'
              ? mapArt.rows.bag
              : mapArt.place
        }
        size={24}
      />
      <View style={styles.itemText}>
        <Text style={typography.label}>{item.name}</Text>
        <Text style={styles.caption}>
          {item.institution ? item.institution.source + ' · ' : '습득 위치 · '}
          {item.foundLocation.label}
        </Text>
        {item.institution && (
          <Text style={styles.caption}>
            {item.institution.dateLabel} {item.institution.date}
            {item.institution.dateLabel === '게시일' && ' · 습득일 미공개'} ·{' '}
            {item.institution.reference}
            {item.institution.lastVerifiedOn &&
              ' · 마지막 보관 확인 ' + item.institution.lastVerifiedOn}
          </Text>
        )}
      </View>
      <View style={styles.distance}>
        <Text style={[typography.label, styles.blue]}>{item.distanceM}m</Text>
        <Text style={styles.caption}>{date}</Text>
      </View>
    </Pressable>
  );
}

type AreaCount = {
  status: 'counting' | 'complete' | 'partial' | 'unavailable';
  total: number | null;
  incomplete: string[];
};
const emptyItems: MapItem[] = [];
export function NearbyScreen() {
  const [center, setCenter] = useState(campus);
  const [visible, setVisible] = useState(campus);
  const [searchedArea, setSearchedArea] = useState<{ point: Coordinates; label: string }>();
  const [position, setPosition] = useState<Coordinates>();
  const [result, setResult] = useState<{
    params: string;
    reload: number;
    rows: MapItem[];
    total: number | null;
    error: string;
  }>();
  const [count, setCount] = useState<{ params: string; reload: number; value: AreaCount }>();
  const [agencies, setAgencies] = useState<{
    params: string;
    reload: number;
    rows: NearbyRow[];
    notices: string[];
    nextCursor: string | null;
    loadingMore?: boolean;
  }>();
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const locationAttempt = useRef(0);
  const hasSearchArea = useRef(false);
  const moreRequest = useRef<AbortController | null>(null);
  const [filters, setFilters] = useState(defaultFilters);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [overlay, setOverlay] = useState<'filters' | 'location'>();

  useFocusEffect(
    useCallback(() => {
      if (!searching) return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setSearching(false);
        return true;
      });
      return () => subscription.remove();
    }, [searching]),
  );

  const params = searchedArea
    ? new URLSearchParams({
        lat: String(searchedArea.point.lat),
        lng: String(searchedArea.point.lng),
        radiusM: String(filters.radiusM),
        category: filters.category,
        registeredDays: filters.registeredDays,
        q: query,
      }).toString()
    : '';
  const membersReady = result?.params === params && result.reload === reload;
  const agenciesReady = agencies?.params === params && agencies.reload === reload;
  const loading = !membersReady && !agenciesReady;
  const memberRows = membersReady ? result.rows : emptyItems;
  const agencyRows = agenciesReady ? agencies.rows : emptyItems;
  const items: NearbyRow[] = useMemo(
    () => [...memberRows, ...agencyRows].sort((a, b) => a.distanceM - b.distanceM),
    [memberRows, agencyRows],
  );
  const areaCount = count?.params === params && count.reload === reload ? count.value : undefined;
  const total =
    membersReady && result.total != null && areaCount?.total != null
      ? result.total + areaCount.total
      : null;
  const countFailed = (membersReady && !!result.error) || areaCount?.status === 'unavailable';
  const loadError = membersReady && !items.length && agenciesReady ? result.error : '';
  const notice = [
    agenciesReady ? agencies.notices.join(' ') : '기관 보관품을 확인하고 있어요.',
    membersReady && items.length ? result.error : '',
  ]
    .filter(Boolean)
    .join(' ');
  useEffect(() => {
    if (!params) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refreshCount() {
      let value: AreaCount;
      try {
        value = await mapApi<AreaCount>('/institution-items/nearby-total?' + params, {
          signal: controller.signal,
        });
      } catch {
        value = { status: 'unavailable', total: null, incomplete: [] };
      }
      if (controller.signal.aborted) return;
      setCount({ params, reload, value });
      if (value.status !== 'complete')
        timer = setTimeout(() => void refreshCount(), value.status === 'counting' ? 3500 : 65000);
    }
    void refreshCount();
    nearbyInstitutions(params, controller.signal)
      .then(({ items, notices, nextCursor }) => {
        if (!controller.signal.aborted)
          setAgencies({
            params,
            reload,
            rows: items.map((item) => ({ ...item, foundAt: item.date, institution: item })),
            notices,
            nextCursor,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setAgencies({
            params,
            reload,
            rows: [],
            notices: ['기관 자료를 현재 조회할 수 없어요.'],
            nextCursor: null,
          });
      });
    nearbyMembers(params, controller.signal)
      .then(({ data: rows, meta }) => {
        if (!controller.signal.aborted)
          setResult({ params, reload, rows, total: meta.total, error: '' });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            params,
            reload,
            rows: [],
            total: null,
            error: '주변 습득물을 불러오지 못했어요.',
          });
      });
    return () => {
      clearTimeout(timer);
      controller.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
    };
  }, [params, reload]);
  async function loadMoreInstitutions() {
    if (!agenciesReady || !agencies.nextCursor || moreRequest.current) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setExpanded(true);
    const currentPage = (state: typeof agencies) =>
      state?.params === params &&
      state.reload === reload &&
      state.nextCursor === agencies.nextCursor;
    setAgencies((prev) => (prev && currentPage(prev) ? { ...prev, loadingMore: true } : prev));
    try {
      const next = await nearbyInstitutions(params, controller.signal, agencies.nextCursor);
      if (controller.signal.aborted) return;
      setAgencies((prev) => {
        if (!prev || !currentPage(prev)) return prev;
        const rows = new Map(prev.rows.map((row) => [row.id, row]));
        for (const item of next.items)
          rows.set(item.id, { ...item, foundAt: item.date, institution: item });
        return {
          ...prev,
          loadingMore: false,
          rows: [...rows.values()],
          nextCursor: next.nextCursor,
          notices: [
            ...new Set([
              ...prev.notices.filter(
                (n) =>
                  !n.startsWith('다음 페이지') &&
                  (agencies.nextCursor?.startsWith('school:')
                    ? !n.startsWith('한성대 ')
                    : n.startsWith('한성대 ')),
              ),
              ...next.notices,
            ]),
          ],
        };
      });
    } catch {
      if (!controller.signal.aborted)
        setAgencies((prev) =>
          prev && currentPage(prev)
            ? {
                ...prev,
                loadingMore: false,
                notices: [
                  ...prev.notices.filter((n) => !n.startsWith('다음 페이지')),
                  '다음 페이지를 불러오지 못했어요. 더보기를 눌러 다시 시도해 주세요.',
                ],
              }
            : prev,
        );
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
    }
  }
  const pins = useMemo(
    () => items.map((i) => ({ ...i.foundLocation, id: i.id, title: i.name })),
    [items],
  );
  const selected = items.find(({ id }) => id === selectedId);
  const moved =
    searchedArea &&
    (Math.abs(visible.lat - searchedArea.point.lat) > 0.00005 ||
      Math.abs(visible.lng - searchedArea.point.lng) > 0.00005);
  const hasFilters =
    filters.category !== defaultFilters.category ||
    filters.registeredDays !== defaultFilters.registeredDays ||
    filters.radiusM !== defaultFilters.radiusM;
  const category = categories.find(({ value }) => value === filters.category)?.label;
  const radius = radii.find(({ value }) => value === filters.radiusM)?.label;
  const resultLabel = filters.category === 'ALL' ? '이 주변 습득물' : category;

  const centerMap = useCallback((point: Coordinates, label: string) => {
    hasSearchArea.current = true;
    locationAttempt.current++;
    setMessage('');
    setCenter({ ...point });
    setVisible(point);
    setSearchedArea({ point, label });
    setSelectedId(undefined);
  }, []);
  function searchVisibleArea() {
    if (moved) setSearchedArea({ point: visible, label: '선택한 지역' });
  }
  const locate = useCallback(async () => {
    const attempt = ++locationAttempt.current;
    setOverlay(undefined);
    setSearching(false);
    setExpanded(false);
    hasSearchArea.current = false;
    setSearchedArea(undefined);
    setPosition(undefined);
    setMessage('현재 위치를 확인하고 있어요.');
    try {
      const p = await readDeviceLocation();
      if (attempt !== locationAttempt.current) return;
      const point = { lat: p.coords.latitude, lng: p.coords.longitude };
      setPosition(point);
      centerMap(point, '내 주변');
      setQuery('');
      setMessage(
        p.coords.accuracy !== null
          ? '기기 추정 위치 · 예상 오차 반경 약 ' + Math.ceil(p.coords.accuracy) + 'm'
          : '기기가 추정한 위치를 표시했어요.',
      );
    } catch (e) {
      if (attempt !== locationAttempt.current) return;
      centerMap(campus, '기본 지도 · 한성대학교');
      setQuery('');
      setMessage(
        (e instanceof Error ? e.message : '현재 위치를 찾지 못했어요.') +
          ' 장소를 직접 검색할 수도 있어요.',
      );
    }
  }, [centerMap]);
  useFocusEffect(
    useCallback(() => {
      // 상세에서 돌아오면 선택한 보관처와 펼친 페이지를 유지합니다.
      if (!hasSearchArea.current) void locate();
      return () => {
        locationAttempt.current++;
      };
    }, [locate]),
  );
  function updateFilters(next: NearbyFilters) {
    setFilters(next);
    searchVisibleArea();
    setSelectedId(undefined);
    setOverlay(undefined);
  }

  function submitSearch(input: string) {
    if (input === '한성대학교') {
      centerMap(campus, input);
      setQuery('');
    } else {
      setQuery(input);
      searchVisibleArea();
    }
    if (input)
      setRecent((previous) => [input, ...previous.filter((term) => term !== input)].slice(0, 5));
    setSelectedId(undefined);
    setSearching(false);
  }

  function showAll() {
    searchVisibleArea();
    setFilters(defaultFilters);
    setQuery('');
    setExpanded(true);
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        accessibilityElementsHidden={!!overlay}
        importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'}
      >
        {searching ? (
          <NearbySearch
            query={query}
            recent={recent}
            onClose={() => setSearching(false)}
            onLocate={() => setOverlay('location')}
            onSearch={submitSearch}
            onPlace={(point, label) => {
              centerMap(point, label);
              setQuery('');
              setSearching(false);
            }}
          />
        ) : (
          <>
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`현재 검색 지역 ${searchedArea?.label ?? '위치 확인 중'}, 장소 변경`}
                onPress={() => setSearching(true)}
                style={styles.area}
              >
                <Text style={styles.areaName} numberOfLines={1}>
                  {searchedArea?.label ?? '위치 확인 중'}
                </Text>
                <MapIcon source={mapArt.chevron} size={16} />
              </Pressable>
              <TextLink label="내 하루 경로" onPress={() => router.push('/daily-route')} />
            </View>
            <View style={[styles.map, expanded && styles.shortMap]}>
              {searchedArea && (
                <StreetMap
                  center={center}
                  position={position}
                  pins={pins}
                  selectedId={selectedId}
                  onMove={setVisible}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setExpanded(false);
                  }}
                />
              )}
              <View style={styles.tools} pointerEvents="box-none">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="장소 또는 물품 검색"
                  onPress={() => setSearching(true)}
                  style={styles.searchBox}
                >
                  <MapIcon source={mapArt.search} size={20} />
                  <Text numberOfLines={1} style={typography.body}>
                    {query || '장소 또는 물품 검색'}
                  </Text>
                </Pressable>
                <View style={styles.filterRow} pointerEvents="box-none">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="지도 검색 조건"
                    onPress={() => setOverlay('filters')}
                    style={styles.filterButton}
                  >
                    <MapIcon source={mapArt.filter} size={18} />
                  </Pressable>
                  <Chips
                    options={categories}
                    value={filters.category}
                    onChange={(category) => updateFilters({ ...filters, category })}
                  />
                </View>
              </View>
              {!expanded && (
                <View style={styles.mapControls} pointerEvents="box-none">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setSelectedId(undefined);
                      setExpanded(true);
                    }}
                    style={styles.mapButton}
                  >
                    <MapIcon source={mapArt.list} size={18} />
                    <Text style={styles.controlText}>목록 보기</Text>
                  </Pressable>
                  {moved && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={searchVisibleArea}
                      style={styles.mapButton}
                    >
                      <Text style={[styles.controlText, styles.blue]}>이 지역 재검색</Text>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="내 주변"
                    onPress={() => void locate()}
                    style={[styles.mapButton, styles.locate]}
                  >
                    <MapIcon source={mapArt.locate} size={22} />
                  </Pressable>
                </View>
              )}
            </View>
            <View style={[styles.sheet, expanded && styles.expanded]}>
              <View style={styles.handle} />
              <View style={styles.sheetHeading}>
                <Text
                  accessibilityRole="header"
                  accessibilityLiveRegion="polite"
                  style={styles.sheetTitle}
                >
                  {selected
                    ? '선택한 습득물'
                    : total !== null
                      ? resultLabel +
                        (areaCount?.status === 'partial' ? ' · 확인된 총 ' : ' · 총 ') +
                        total.toLocaleString('ko-KR') +
                        '개'
                      : countFailed
                        ? '주변 총건수 조회 불가'
                        : '주변 총건수 확인 중'}
                </Text>
                {selected ? (
                  <TextLink label="닫기" onPress={() => setSelectedId(undefined)} />
                ) : expanded ? (
                  <TextLink label="지도 보기" onPress={() => setExpanded(false)} />
                ) : items.length || (agenciesReady && agencies.nextCursor) ? (
                  <TextLink label="전체 보기" onPress={() => setExpanded(true)} />
                ) : hasFilters ? (
                  <TextLink label="필터 해제" onPress={() => updateFilters(defaultFilters)} />
                ) : query ? (
                  <TextLink label="검색어 지우기" onPress={() => setQuery('')} />
                ) : null}
              </View>
              {!!message && (
                <Text accessibilityLiveRegion="polite" style={styles.caption}>
                  {message}
                </Text>
              )}
              {searchedArea?.label === '기본 지도 · 한성대학교' && (
                <TextLink label="내 위치 다시 확인" onPress={() => void locate()} />
              )}
              {expanded && !!searchedArea && !!notice && (
                <Text accessibilityLiveRegion="polite" style={styles.caption}>
                  {notice}
                </Text>
              )}
              {expanded && !!areaCount?.incomplete.length && (
                <Text style={styles.caption}>
                  전체 조회가 어려운 기관 · {areaCount.incomplete.join(', ')}
                </Text>
              )}
              {!searchedArea ? null : loading ||
                (!items.length && (!membersReady || !agenciesReady)) ? (
                <Text style={styles.caption}>주변 습득물을 불러오는 중이에요.</Text>
              ) : loadError ? (
                <>
                  <Text accessibilityRole="alert">{loadError}</Text>
                  <TextLink label="다시 시도" onPress={() => setReload((n) => n + 1)} />
                </>
              ) : selected ? (
                <>
                  <ItemRow item={selected} />
                  <ActionButton
                    label={selected.institution ? '기관 물품 상세 보기' : '물품 상세 보기'}
                    onPress={() => openDetail(selected)}
                  />
                </>
              ) : !items.length && !(agenciesReady && agencies.nextCursor) ? (
                <View style={styles.empty}>
                  <Text style={typography.label}>
                    {notice
                      ? '조회한 자료에서 조건에 맞는 물품이 없어요'
                      : '조건에 맞는 물품이 아직 없어요'}
                  </Text>
                  <Text style={typography.body}>지도를 옮기거나 검색 조건을 넓혀보세요.</Text>
                  <ActionButton label="전체 물품 보기" variant="outline" onPress={showAll} />
                </View>
              ) : expanded ? (
                <>
                  <Text style={[styles.caption, styles.center]}>가까운 순 · 반경 {radius}</Text>
                  <ScrollView contentContainerStyle={styles.rows}>
                    {items.map((item) => (
                      <ItemRow key={item.id} item={item} />
                    ))}
                    {agenciesReady && !!agencies.nextCursor && (
                      <ActionButton
                        label={
                          agencies.nextCursor.startsWith('school:')
                            ? '한성대 물품 더보기'
                            : '주변 습득물 더보기'
                        }
                        variant="outline"
                        loading={agencies.loadingMore}
                        onPress={() => void loadMoreInstitutions()}
                      />
                    )}
                  </ScrollView>
                </>
              ) : items[0] ? (
                <ItemRow item={items[0]} />
              ) : null}
            </View>
          </>
        )}
        <BottomNavigation selected="nearby" onNearbyReselect={() => void locate()} />
      </KeyboardAvoidingView>
      {overlay === 'filters' && (
        <FilterSheet
          filters={filters}
          onApply={updateFilters}
          onClose={() => setOverlay(undefined)}
        />
      )}
      {overlay === 'location' && (
        <LocationDialog
          onClose={() => setOverlay(undefined)}
          onSearch={() => {
            setOverlay(undefined);
            setSearching(true);
          }}
          onLocate={() => void locate()}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: {
    minHeight: 48,
    paddingHorizontal: 20,
    backgroundColor: colors.white,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  area: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 44, maxWidth: '75%' },
  areaName: { ...typography.heading, fontSize: 20, lineHeight: 28, flexShrink: 1 },
  map: { flex: 1, minHeight: 156 },
  shortMap: { flex: 0, height: 156 },
  tools: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  searchBox: {
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    backgroundColor: colors.white,
    boxShadow: '0 3px 14px rgba(23, 38, 64, 0.1)',
  },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filterButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  mapControls: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  mapButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 24,
    backgroundColor: colors.white,
    boxShadow: '0 3px 14px rgba(23, 38, 64, 0.1)',
  },
  controlText: { ...typography.label, fontSize: 12, fontWeight: '700' },
  locate: { width: 44, paddingHorizontal: 0, justifyContent: 'center' },
  sheet: {
    marginTop: -16,
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.white,
  },
  expanded: { flex: 1 },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  sheetHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetTitle: {
    ...typography.label,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 24,
    flexShrink: 1,
  },
  rows: { gap: 8 },
  item: {
    minHeight: 72,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  itemText: { flex: 1, gap: 2 },
  caption: { ...typography.body, color: colors.muted, fontSize: 12, lineHeight: 18 },
  distance: { alignItems: 'flex-end' },
  blue: { color: colors.blue },
  center: { textAlign: 'center' },
  empty: { gap: 8, paddingVertical: 4 },
});
