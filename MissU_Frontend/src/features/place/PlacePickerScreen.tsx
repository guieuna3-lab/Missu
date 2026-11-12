import * as Location from 'expo-location';
import { api, ApiError } from '@/lib/backend';
import { devicePlaceLabel, isCurrentLocationLabel, lookupPlaceAddress } from '@/lib/placeAddress';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage } from '@/components/FormField';
import { Icon } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';
import type { Place } from '@/lib/activity/types';
import { type PlaceOption } from './places';
import { PlaceMap } from './PlaceMap';

// Figma 09.01–09.04 and 09.02-E, also used as 04.04. The caller decides what happens with
// the chosen place (save the lost report, or return to the found-item form).
export function PlacePickerScreen({
  variant,
  initialPlace,
  submitting = false,
  error,
  onSelect,
  onBack,
}: {
  /** 'lost' shows the 04.04 title header and step; 'found' shows the 09 wordmark header. */
  variant: 'lost' | 'found';
  initialPlace?: Place;
  submitting?: boolean;
  error?: string;
  onSelect: (place: Place) => void;
  onBack: () => void;
}) {
  const { accessToken } = usePreview();
  const detailRevision = useRef(0);
  // 좌표는 선택한 장소 또는 사용자가 허용한 기기 위치에서만 가져옵니다.
  const [placeOptions, setPlaceOptions] = useState<PlaceOption[]>(() => [
    {
      id: 'current',
      name: '현재 위치',
      description: '카카오에서 현재 위치의 주소를 확인합니다.',
      icon: 'book',
    },
    ...(initialPlace?.lat != null && initialPlace?.lng != null
      ? [
          {
            id: 'previous',
            name: initialPlace.name,
            description: initialPlace.detail,
            icon: 'book' as const,
            lat: initialPlace.lat,
            lng: initialPlace.lng,
          },
        ]
      : []),
  ]);
  const [looking, setLooking] = useState(false);
  const [query, setQuery] = useState('');
  // null until a search ran; then the result list (possibly empty, Figma 09.02-E).
  const [results, setResults] = useState<PlaceOption[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => placeOptions.find((p) => p.id === 'previous')?.id,
  );
  const [detail, setDetail] = useState(
    isCurrentLocationLabel(initialPlace?.detail ?? '') ? '' : (initialPlace?.detail ?? ''),
  );
  const [detailError, setDetailError] = useState<string>();
  const selected = placeOptions.find((p) => p.id === selectedId);
  const noResults = results !== null && results.length === 0;

  const searchVersion = useRef(0);
  useEffect(
    () => () => {
      searchVersion.current++;
    },
    [],
  );
  function changeQuery(value: string) {
    searchVersion.current++;
    setQuery(value);
    setLooking(false);
    setResults(null);
    setPlaceOptions((old) => old.filter((place) => place.id === 'current'));
    setSelectedId(undefined);
    setDetailError(undefined);
  }

  async function search() {
    const version = ++searchVersion.current;
    Keyboard.dismiss();
    setSelectedId(undefined);
    setDetailError(undefined);
    if (!query.trim()) {
      setResults(null);
      return;
    }
    setLooking(true);
    try {
      const response = await api<{
        data: {
          providerPlaceId: string;
          name: string;
          address: string;
          lat: number;
          lng: number;
        }[];
      }>('/places?q=' + encodeURIComponent(query.trim()));
      if (version !== searchVersion.current) return;
      const matches = response.data.map((p) => ({
        id: p.providerPlaceId,
        name: p.name,
        description: p.address,
        lat: p.lat,
        lng: p.lng,
        icon: 'book' as const,
      }));
      setPlaceOptions((old) => [old[0], ...matches]);
      setResults(matches);
    } catch (e) {
      if (version !== searchVersion.current) return;
      setResults(null);
      setDetailError(
        e instanceof ApiError && e.status === 503
          ? '장소 검색을 잠시 사용할 수 없어요. 잠시 후 다시 검색해 주세요.'
          : '장소를 불러오지 못했어요.',
      );
    } finally {
      if (version === searchVersion.current) setLooking(false);
    }
  }

  async function choose(id: string) {
    const place = placeOptions.find((p) => p.id === id);
    if (!place) return;
    const version = ++searchVersion.current;
    const current = id === 'current';
    const previous = id === 'previous' && isCurrentLocationLabel(initialPlace?.detail ?? '');
    setSelectedId(id);
    setDetailError(undefined);
    if (!current && !previous) {
      setLooking(false);
      setDetail((value) =>
        value.trim() && selectedId === id ? value : place.description || place.name,
      );
      return;
    }

    setDetail('');
    const editAtStart = detailRevision.current;
    setLooking(true);
    const updatePlace = (patch: Partial<PlaceOption>) => {
      setPlaceOptions((options) => options.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    };
    if (current)
      updatePlace({
        lat: undefined,
        lng: undefined,
        address: undefined,
        description: '기기 위치를 확인하고 있어요.',
      });
    try {
      let lat = place.lat,
        lng = place.lng;
      if (current) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (version !== searchVersion.current) return;
        if (!permission.granted) {
          updatePlace({ description: '위치 권한이 필요해요.' });
          setDetailError('현재 위치를 사용하려면 위치 접근을 허용하거나 장소를 검색해 주세요.');
          return;
        }
        const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (version !== searchVersion.current) return;
        lat = point.coords.latitude;
        lng = point.coords.longitude;
      }
      if (lat == null || lng == null) return;
      // GPS를 먼저 지도에 표시합니다. 주소 서비스가 응답하지 않아도 이 좌표로 장소를 직접 입력할 수 있습니다.
      updatePlace({ lat, lng, description: '주소를 확인하고 있어요.' });
      const address = await lookupPlaceAddress({ lat, lng }, accessToken).catch(() => null);
      if (version !== searchVersion.current) return;
      updatePlace({
        address: address ?? undefined,
        description: address ?? '주소나 알아볼 수 있는 장소명을 직접 입력해 주세요.',
      });
      if (address && detailRevision.current === editAtStart) setDetail(address);
    } catch {
      if (version === searchVersion.current) {
        updatePlace({ description: '기기 위치를 확인하지 못했어요.' });
        setDetailError('현재 위치를 확인할 수 없어요. 장소를 검색하거나 다시 눌러 주세요.');
      }
    } finally {
      if (version === searchVersion.current) setLooking(false);
    }
  }

  function confirm() {
    if (!selected || submitting || looking) return;
    if (selected.lat == null || selected.lng == null) {
      if (selected.id === 'current') void choose('current');
      return;
    }
    const devicePlace =
      selected.id === 'current' ||
      (selected.id === 'previous' && isCurrentLocationLabel(initialPlace?.detail ?? ''));
    const label = devicePlace ? devicePlaceLabel(selected.address, detail) : detail.trim();
    if (!label) {
      setDetailError('주소나 알아볼 수 있는 장소명을 입력해 주세요.');
      return;
    }
    if (label.length > 200) {
      setDetailError('주소와 상세 위치를 합쳐 200자 이내로 입력해 주세요.');
      return;
    }
    Keyboard.dismiss();
    onSelect({
      name: devicePlace ? selected.address || label : selected.name,
      detail: label,
      lat: selected.lat,
      lng: selected.lng,
    });
  }

  const listTitle = selected
    ? '선택한 장소'
    : results
      ? `검색 결과 ${results.length}곳`
      : '지도 주변 장소';
  const rows = selected ? [selected] : (results ?? placeOptions);
  const previousStep = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="이전 단계"
      onPress={onBack}
      hitSlop={8}
      style={styles.previous}
    >
      <Text style={styles.previousText}>← 이전 단계</Text>
    </Pressable>
  );

  if (noResults)
    return (
      <FlowScreen
        wordmark={variant === 'found'}
        title="분실 장소"
        onBack={onBack}
        step={variant === 'lost' ? '3 / 3' : undefined}
        heading="검색 결과가 없어요"
        description="장소명이나 주소를 다시 입력해 주세요."
        actions={
          <>
            <ActionButton label="장소 검색하기" onPress={search} />
            {previousStep}
          </>
        }
      >
        <ActionButton
          label="다시 확인하기"
          variant="outline"
          onPress={() => {
            changeQuery('');
          }}
          style={styles.blueOutline}
        />
      </FlowScreen>
    );

  return (
    <FlowScreen
      wordmark={variant === 'found'}
      title="분실 장소"
      onBack={onBack}
      step={variant === 'lost' ? '3 / 3' : undefined}
      heading={
        variant === 'found' && !results && !selected ? '어디서 주웠나요?' : '지도에서 장소 선택'
      }
      actions={
        <>
          <ActionButton
            label={selected ? '이 장소로 선택' : '장소 검색하기'}
            onPress={selected ? confirm : search}
            loading={submitting || looking}
          />
          {previousStep}
        </>
      }
    >
      <View style={styles.searchBox}>
        <Icon name="search" />
        <TextInput
          accessibilityLabel="장소명 또는 주소 검색"
          placeholder="장소명 또는 주소 검색"
          placeholderTextColor={colors.body}
          value={query}
          onChangeText={changeQuery}
          onSubmitEditing={search}
          returnKeyType="search"
          style={styles.input}
        />
      </View>
      {!selected && detailError && <FormMessage>{detailError}</FormMessage>}
      <View style={styles.mapBleed}>
        <PlaceMap places={placeOptions} selectedId={selectedId} onSelect={choose} />
      </View>
      <Text style={styles.listTitle}>{listTitle}</Text>
      {rows.map((place) => {
        const active = place.id === selectedId;
        return (
          <Pressable
            key={place.id}
            accessibilityRole="button"
            accessibilityLabel={`${place.name}, ${place.description}`}
            accessibilityState={{ selected: active }}
            onPress={() => choose(place.id)}
            style={({ pressed }) => [
              styles.row,
              active && styles.activeRow,
              pressed && styles.pressed,
            ]}
          >
            <Icon name={place.icon} />
            <View style={styles.rowText}>
              <Text style={typography.label}>{place.name}</Text>
              <Text style={styles.description}>{place.description}</Text>
            </View>
            {active && <Text style={styles.selectedMark}>선택</Text>}
          </Pressable>
        );
      })}
      {selected?.id === 'previous' &&
        isCurrentLocationLabel(initialPlace?.detail ?? '') &&
        !selected.address && (
          <ActionButton
            variant="outline"
            label="저장된 위치의 주소 확인"
            onPress={() => void choose('previous')}
            loading={looking}
          />
        )}
      {selected && (
        <FormField
          label="건물·층·출구 등 상세 위치"
          placeholder={`${selected.name} 3층 열람실`}
          value={detail}
          onChangeText={(value) => {
            detailRevision.current++;
            setDetail(value);
            setDetailError(undefined);
          }}
          error={detailError}
          onSubmitEditing={confirm}
        />
      )}
      {error && <FormMessage>{error}</FormMessage>}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  input: {
    ...typography.body,
    flex: 1,
    alignSelf: 'stretch',
    paddingVertical: 0,
    color: colors.ink,
  },
  mapBleed: { marginHorizontal: -20 },
  listTitle: { ...typography.body, color: colors.muted },
  row: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  activeRow: { borderColor: colors.blue },
  pressed: { opacity: 0.75 },
  rowText: { flex: 1, gap: 2 },
  description: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  selectedMark: { ...typography.label, color: colors.blue },
  previous: { minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  previousText: { ...typography.body, color: colors.body },
  blueOutline: { borderColor: colors.blue },
});
