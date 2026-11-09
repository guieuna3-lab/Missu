import { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/constants/theme';
import { MapIcon, mapArt } from './mapArt';
import { mapOrigin, places, zeroOffset, type MapPoint, type NearbyItem } from './nearbyItems';

const widthInDesign = 390;
const labels = [
  { x: 139, y: 222 },
  { x: 16, y: 344 },
  { x: 301, y: 315 },
  { x: 151, y: 434 },
  { x: 307, y: 514 },
  { x: 201, y: 661 },
  { x: 23, y: 123 },
];

function limit(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function CampusMap({
  offset,
  items,
  selectedId,
  showOrigin,
  onMove,
  onSelect,
}: {
  offset: MapPoint;
  items: NearbyItem[];
  selectedId: string | undefined;
  showOrigin: boolean;
  onMove: (offset: MapPoint) => void;
  onSelect: (id: string) => void;
}) {
  const [width, setWidth] = useState(widthInDesign);
  const scale = width / widthInDesign;
  const [drag] = useState(() => new Animated.ValueXY());
  const responder = useMemo(() => {
    function nextOffset(dx: number, dy: number) {
      return {
        x: limit(offset.x + dx / scale, -180, 210),
        y: limit(offset.y + dy / scale, -320, 250),
      };
    }
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dx, dy }) => Math.hypot(dx, dy) > 8,
      onPanResponderMove: (_, { dx, dy }) => {
        const next = nextOffset(dx, dy);
        drag.setValue({ x: (next.x - offset.x) * scale, y: (next.y - offset.y) * scale });
      },
      onPanResponderRelease: (_, { dx, dy }) => {
        drag.setValue(zeroOffset);
        const next = nextOffset(dx, dy);
        if (next.x !== offset.x || next.y !== offset.y) onMove(next);
      },
      onPanResponderTerminate: () => drag.setValue(zeroOffset),
    });
  }, [drag, offset, onMove, scale]);

  return (
    <View
      {...responder.panHandlers}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width || widthInDesign)}
      style={styles.map}
    >
      <Animated.View
        style={[
          styles.plane,
          {
            width,
            height: 716 * scale,
            left: offset.x * scale,
            top: (offset.y - 48) * scale,
            transform: drag.getTranslateTransform(),
          },
        ]}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Image
            accessible={false}
            source={mapArt.campus}
            contentFit="contain"
            style={StyleSheet.absoluteFill}
          />
        </View>
        {labels.map((point, index) => (
          <Text
            key={places[index + 1].name}
            accessibilityElementsHidden
            importantForAccessibility="no"
            pointerEvents="none"
            style={[styles.label, { left: point.x * scale, top: point.y * scale }]}
          >
            {places[index + 1].name}
          </Text>
        ))}
        {showOrigin && (
          <View
            pointerEvents="none"
            style={[
              styles.origin,
              { left: mapOrigin.x * scale - 24, top: mapOrigin.y * scale - 24 },
            ]}
          >
            <MapIcon source={mapArt.accuracy} size={48} />
            <View style={styles.dot}>
              <MapIcon source={mapArt.dot} size={16} />
            </View>
          </View>
        )}
        {items.map(({ id, marker, name }) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={`지도에서 ${name} 선택`}
            accessibilityState={{ selected: id === selectedId }}
            hitSlop={4}
            onPress={() => onSelect(id)}
            style={[
              styles.marker,
              { left: marker.x * scale - 20, top: marker.y * scale - 20 },
              selectedId === id && styles.activeMarker,
            ]}
          >
            <MapIcon
              source={mapArt.markers[marker.icon]}
              size={14}
              tintColor={selectedId === id ? colors.white : undefined}
            />
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#E8F0FE' },
  plane: { position: 'absolute' },
  label: {
    ...typography.body,
    position: 'absolute',
    color: '#7E8EA5',
    fontSize: 11,
    lineHeight: 17,
  },
  origin: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute' },
  marker: {
    position: 'absolute',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.white,
    boxShadow: '0 3px 7px rgba(23, 38, 64, 0.1)',
  },
  activeMarker: { backgroundColor: colors.blue },
});
