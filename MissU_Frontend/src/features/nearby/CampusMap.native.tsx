import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import type { CampusMapProps } from './CampusMap';
import { coordinateForPoint, mapOrigin, pointForCoordinate } from './nearbyItems';

export function CampusMap({
  offset,
  items,
  selectedId,
  userPosition,
  onMove,
  onSelect,
}: CampusMapProps) {
  const map = useRef<MapView>(null);
  const { latitude, longitude } = coordinateForPoint({
    x: mapOrigin.x - offset.x,
    y: mapOrigin.y - offset.y,
  });
  const [initialRegion] = useState(() => ({
    latitude,
    longitude,
    latitudeDelta: 0.012,
    longitudeDelta: 0.012,
  }));
  const region = useRef(initialRegion);

  useEffect(() => {
    const current = region.current;
    if (
      Math.abs(latitude - current.latitude) < 0.00001 &&
      Math.abs(longitude - current.longitude) < 0.00001
    )
      return;
    region.current = { ...current, latitude, longitude };
    map.current?.animateToRegion(region.current, 300);
  }, [latitude, longitude]);

  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      toolbarEnabled={false}
      onRegionChangeComplete={(next, details) => {
        if (details.isGesture === false) return;
        const point = pointForCoordinate(next);
        const moved =
          Math.abs(next.latitude - region.current.latitude) >= 0.00001 ||
          Math.abs(next.longitude - region.current.longitude) >= 0.00001;
        region.current = next;
        if (moved) onMove({ x: mapOrigin.x - point.x, y: mapOrigin.y - point.y });
      }}
    >
      {userPosition && <Marker coordinate={userPosition} title="내 위치" pinColor="blue" />}
      {items.map((item) => (
        <Marker
          key={item.id}
          coordinate={coordinateForPoint(item.marker)}
          title={item.name}
          pinColor={selectedId === item.id ? 'blue' : 'red'}
          onPress={() => onSelect(item.id)}
        />
      ))}
    </MapView>
  );
}
