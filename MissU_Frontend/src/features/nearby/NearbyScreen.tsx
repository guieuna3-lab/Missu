import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import {
  Alert,
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
import { CampusMap } from './CampusMap';
import { MapIcon, mapArt } from './mapArt';
import {
  categories,
  coordinateForPoint,
  defaultFilters,
  mapOrigin,
  places,
  pointForCoordinate,
  radii,
  nearbyFromServer,
  zeroOffset,
  type MapCoordinate,
  type MapPoint,
  type NearbyFilters,
  type NearbyItem,
} from './nearbyItems';
import { Chips, FilterSheet, LocationDialog } from './NearbyOptions';
import { NearbySearch } from './NearbySearch';

const hasNativeMap = Platform.OS === 'android' || Platform.OS === 'ios';
const defaultAreaLabel = hasNativeMap ? '한성대학교' : '삼선동';

function openDetail(id: string) {
  router.push({ pathname: '/items/[id]', params: { id } });
}

function ItemRow({ item }: { item: NearbyItem }) {
  const date = formatFoundAt(item.foundAt).slice(5, 10);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name} 상세 보기, ${item.location}, ${item.distanceM}m`}
      onPress={() => openDetail(item.id)}
      style={styles.item}
    >
      <MapIcon source={mapArt.rows[item.marker.icon]} size={24} />
      <View style={styles.itemText}>
        <Text style={typography.label}>{item.name}</Text>
        <Text style={styles.caption}>{item.location}</Text>
      </View>
      <View style={styles.distance}>
        <Text style={[typography.label, styles.blue]}>{item.distanceM}m</Text>
        <Text style={styles.caption}>{date}</Text>
      </View>
    </Pressable>
  );
}

export function NearbyScreen() {
  const [offset, setOffset] = useState<MapPoint>(zeroOffset);
  const [searchedArea, setSearchedArea] = useState({ offset: zeroOffset, label: defaultAreaLabel });
  const [filters, setFilters] = useState(defaultFilters);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [overlay, setOverlay] = useState<'filters' | 'location'>();
  const [userPosition, setUserPosition] = useState<MapCoordinate>();
  const locating = useRef(false);

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

  const searchCenter = coordinateForPoint({
    x: mapOrigin.x - searchedArea.offset.x,
    y: mapOrigin.y - searchedArea.offset.y,
  });
  const { latitude, longitude } = searchCenter;
  const queryKey = JSON.stringify([filters, query, latitude, longitude]);
  const [result, setResult] = useState<{
    key: string;
    rows: NearbyItem[];
    state: 'ready' | 'error';
  }>();
  const items = result?.key === queryKey ? result.rows : [];
  const nearbyState = result?.key === queryKey ? result.state : 'loading';
  useEffect(() => {
    let active = true;
    nearbyFromServer(filters, query, latitude, longitude)
      .then((rows) => {
        if (active) setResult({ key: queryKey, rows, state: 'ready' });
      })
      .catch(() => {
        if (active) setResult({ key: queryKey, rows: [], state: 'error' });
      });
    return () => {
      active = false;
    };
  }, [filters, query, latitude, longitude, queryKey]);
  const selected = items.find(({ id }) => id === selectedId);
  const moved = offset.x !== searchedArea.offset.x || offset.y !== searchedArea.offset.y;
  const hasFilters =
    filters.category !== defaultFilters.category ||
    filters.registeredDays !== defaultFilters.registeredDays ||
    filters.radiusM !== defaultFilters.radiusM;
  const category = categories.find(({ value }) => value === filters.category)?.label;
  const radius = radii.find(({ value }) => value === filters.radiusM)?.label;
  const resultLabel = filters.category === 'ALL' ? '이 주변 습득물' : category;

  const moveMap = useCallback((point: MapPoint) => {
    setOffset(point);
    setSelectedId(undefined);
  }, []);

  function centerMap(point: MapPoint, label: string) {
    const next = { x: mapOrigin.x - point.x, y: mapOrigin.y - point.y };
    moveMap(next);
    setSearchedArea({ offset: next, label });
  }

  async function locate() {
    if (locating.current) return;
    locating.current = true;
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) {
        Alert.alert('위치 권한이 필요해요.', '장소를 직접 검색할 수도 있어요.');
        return;
      }
      const { coords } = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      });
      const point = { latitude: coords.latitude, longitude: coords.longitude };
      setUserPosition(point);
      centerMap(pointForCoordinate(point), '내 위치');
      setQuery('');
      setSearching(false);
      setExpanded(false);
    } catch {
      Alert.alert(
        '현재 위치를 가져오지 못했어요.',
        '기기의 위치 설정을 확인하거나 장소를 검색해 주세요.',
      );
    } finally {
      locating.current = false;
    }
  }

  function searchVisibleArea() {
    if (moved) setSearchedArea({ offset, label: '선택한 지역' });
  }

  function updateFilters(next: NearbyFilters) {
    setFilters(next);
    searchVisibleArea();
    setSelectedId(undefined);
    setOverlay(undefined);
  }

  function submitSearch(input: string) {
    const place = places.find(({ name }) => name === input);
    if (place) {
      const point =
        hasNativeMap && 'coordinate' in place ? pointForCoordinate(place.coordinate) : place.point;
      centerMap(point, place.name);
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
    centerMap(mapOrigin, defaultAreaLabel);
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
            onLocate={locate}
            onSearch={submitSearch}
          />
        ) : (
          <>
            <View style={styles.header}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`현재 검색 지역 ${searchedArea.label}, 장소 변경`}
                onPress={() => setSearching(true)}
                style={styles.area}
              >
                <Text style={styles.areaName} numberOfLines={1}>
                  {searchedArea.label}
                </Text>
                <MapIcon source={mapArt.chevron} size={16} />
              </Pressable>
              <Text style={styles.caption}>{hasNativeMap ? '주변 습득물' : '위치 안내도'}</Text>
            </View>
            <View style={[styles.map, expanded && styles.shortMap]}>
              <CampusMap
                offset={offset}
                items={items}
                selectedId={selectedId}
                showOrigin={overlay !== 'location'}
                userPosition={userPosition}
                onMove={moveMap}
                onSelect={(id) => {
                  setSelectedId(id);
                  setExpanded(false);
                }}
              />
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
                    onPress={locate}
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
                  {nearbyState === 'loading'
                    ? '불러오는 중…'
                    : nearbyState === 'error'
                      ? '주변 습득물을 불러오지 못했어요.'
                      : selected
                        ? '선택한 습득물'
                        : `${resultLabel} ${items.length}개`}
                </Text>
                {selected ? (
                  <TextLink label="닫기" onPress={() => setSelectedId(undefined)} />
                ) : expanded ? (
                  <TextLink label="지도 보기" onPress={() => setExpanded(false)} />
                ) : items.length ? (
                  <TextLink label="전체 보기" onPress={() => setExpanded(true)} />
                ) : hasFilters ? (
                  <TextLink label="필터 해제" onPress={() => updateFilters(defaultFilters)} />
                ) : query ? (
                  <TextLink label="검색어 지우기" onPress={() => setQuery('')} />
                ) : null}
              </View>
              {selected ? (
                <>
                  <ItemRow item={selected} />
                  <ActionButton label="물품 상세 보기" onPress={() => openDetail(selected.id)} />
                </>
              ) : !items.length ? (
                <View style={styles.empty}>
                  <Text style={typography.label}>조건에 맞는 물품이 아직 없어요</Text>
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
                  </ScrollView>
                </>
              ) : (
                <ItemRow item={items[0]} />
              )}
            </View>
          </>
        )}
        <BottomNavigation selected="nearby" />
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
          onUseExample={() => {
            centerMap(mapOrigin, defaultAreaLabel);
            setQuery('');
            setExpanded(false);
            setSearching(false);
            setOverlay(undefined);
          }}
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
