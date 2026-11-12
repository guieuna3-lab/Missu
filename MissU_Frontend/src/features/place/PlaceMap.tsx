import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/constants/theme';
import { campus } from '@/features/nearby/mapData';
import { StreetMap } from '@/features/nearby/StreetMap';
import { placePins, type PlaceOption } from './places';

export function PlaceMap({
  places,
  selectedId,
  onSelect,
}: {
  places: PlaceOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const pins = useMemo(() => placePins(places), [places]);
  const selected = pins.find((pin) => pin.id === selectedId);
  // 아직 장소를 고르지 않았으면 첫 검색 결과를, 검색 전에는 한성대를 보여 줍니다.
  const center = selected ?? pins.find((pin) => pin.id !== 'current') ?? pins[0] ?? campus;
  return (
    <View style={styles.map}>
      <StreetMap center={center} pins={pins} selectedId={selectedId} onSelect={onSelect} />
      {center === campus && (
        <View style={styles.legend} pointerEvents="none">
          <Text style={styles.label}>한성대학교 기준</Text>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  map: { width: '100%', height: 223, position: 'relative', overflow: 'hidden' },
  legend: {
    position: 'absolute',
    left: 8,
    top: 8,
    backgroundColor: colors.white,
    borderRadius: 7,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  label: { ...typography.label, color: colors.body, fontSize: 12 },
});
