import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage } from '@/components/FormField';
import { Icon } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';
import type { Place } from '@/lib/activity/types';
import { placeOptions, searchPlaces, type PlaceOption } from './places';
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
  const [query, setQuery] = useState('');
  // null until a search ran; then the result list (possibly empty, Figma 09.02-E).
  const [results, setResults] = useState<PlaceOption[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => placeOptions.find((p) => p.name === initialPlace?.name)?.id,
  );
  const [detail, setDetail] = useState(initialPlace?.detail ?? '');
  const [detailError, setDetailError] = useState<string>();
  const selected = placeOptions.find((p) => p.id === selectedId);
  const noResults = results !== null && results.length === 0;

  function search() {
    Keyboard.dismiss();
    setResults(searchPlaces(query));
    setSelectedId(undefined);
  }

  function choose(id: string) {
    const place = placeOptions.find((p) => p.id === id);
    if (!place) return;
    setSelectedId(id);
    setDetail((current) => (current.trim() && selectedId === id ? current : place.name));
    setDetailError(undefined);
  }

  function confirm() {
    if (!selected || submitting) return;
    const text = detail.trim();
    if (!text) {
      setDetailError('건물·층·출구 등 상세 위치를 입력해 주세요.');
      return;
    }
    Keyboard.dismiss();
    onSelect({ name: selected.name, detail: text });
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
            setResults(null);
            setQuery('');
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
            loading={submitting}
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
          onChangeText={setQuery}
          onSubmitEditing={search}
          returnKeyType="search"
          style={styles.input}
        />
      </View>
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
      {selected && (
        <FormField
          label="건물·층·출구 등 상세 위치"
          placeholder={`${selected.name} 3층 열람실`}
          value={detail}
          onChangeText={(value) => {
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
