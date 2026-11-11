import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';
import type { PlaceOption } from './places';

// The illustrated map of Figma 09 ("Place Map / editable vectors", 390×208): blocks, roads,
// a park and one pin per example place. It is a drawing, not a map provider (D10).
const designWidth = 390;
const designHeight = 208;
const blocks = [
  { x: 10, y: 20, w: 80, h: 70 },
  { x: 130, y: 20, w: 90, h: 70 },
  { x: 260, y: 20, w: 110, h: 70 },
  { x: 10, y: 110, w: 80, h: 48 },
  { x: 130, y: 110, w: 90, h: 48 },
  { x: 260, y: 110, w: 110, h: 48 },
];

export function PlaceMap({
  places,
  selectedId,
  onSelect,
}: {
  places: PlaceOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [width, setWidth] = useState(designWidth);
  const scale = width / designWidth;
  const size = (value: number) => value * scale;
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width || designWidth)}
      style={[styles.map, { height: size(designHeight) }]}
    >
      {blocks.map((block, index) => (
        <View
          key={index}
          pointerEvents="none"
          style={[
            styles.block,
            {
              left: size(block.x),
              top: size(block.y),
              width: size(block.w),
              height: size(block.h),
            },
          ]}
        />
      ))}
      <View
        pointerEvents="none"
        style={[styles.park, { left: size(36), top: size(70), width: size(50), height: size(20) }]}
      />
      {places.map((place) => {
        const selected = place.id === selectedId;
        return (
          <View
            key={place.id}
            style={[styles.pinGroup, { left: size(place.pin.x) - 52, top: size(place.pin.y) - 22 }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`지도에서 ${place.name} 선택`}
              accessibilityState={{ selected }}
              onPress={() => onSelect(place.id)}
              style={[styles.pin, selected && styles.selectedPin]}
            >
              <Icon name={place.icon} size={28} tintColor={selected ? colors.white : undefined} />
            </Pressable>
            <View style={styles.label} pointerEvents="none">
              <Text style={styles.labelText}>{place.name}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { width: '100%', overflow: 'hidden', backgroundColor: '#E8EFFC' },
  block: { position: 'absolute', borderRadius: 10, backgroundColor: '#D5E1F8' },
  park: { position: 'absolute', borderRadius: 999, backgroundColor: '#BFE8C8' },
  pinGroup: { position: 'absolute', width: 104, alignItems: 'center', gap: 4 },
  pin: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.white,
    boxShadow: '0 3px 10px rgba(23, 38, 64, 0.12)',
  },
  selectedPin: { backgroundColor: colors.blue },
  label: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.white,
    boxShadow: '0 2px 6px rgba(23, 38, 64, 0.1)',
  },
  labelText: { ...typography.label, fontSize: 12, lineHeight: 18 },
});
