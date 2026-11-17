import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { routeSegments, type Coordinates, type StreetMapProps, type RoutePoint } from './mapData';
import { MapLoadingOverlay, useMapDrawn } from './MapLoading';
const emptyPath: RoutePoint[] = [];

function coordinate(p: Coordinates) {
  return { latitude: p.lat, longitude: p.lng };
}
export function StreetMap({
  center,
  pins = [],
  selectedId,
  position,
  startPoint,
  path = emptyPath,
  fitPath,
  onMove,
  onSelect,
}: StreetMapProps) {
  const view = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [drawn, markDrawn] = useMapDrawn();
  const framedPath = fitPath ? path : undefined;
  useEffect(() => {
    if (!ready) return;
    if (framedPath && framedPath.length > 1) {
      view.current?.fitToCoordinates(framedPath.map(coordinate), {
        edgePadding: { top: 60, bottom: 60, left: 35, right: 35 },
        animated: false,
      });
    } else {
      view.current?.animateCamera({ center: coordinate(center) }, { duration: 250 });
    }
  }, [ready, center, framedPath]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={view}
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ ...coordinate(center), latitudeDelta: 0.012, longitudeDelta: 0.012 }}
        showsMyLocationButton={false}
        onMapReady={() => setReady(true)}
        onMapLoaded={markDrawn}
        onRegionChangeComplete={(r) => onMove?.({ lat: r.latitude, lng: r.longitude })}
      >
        {position && (
          <Marker coordinate={coordinate(position)} title="내 위치" pinColor="#1a73e8" />
        )}
        {pins.map((p) => (
          <Marker
            key={p.id}
            coordinate={coordinate(p)}
            title={p.title}
            pinColor={p.id === selectedId ? 'orange' : 'red'}
            onPress={() => onSelect?.(p.id)}
          />
        ))}
        {routeSegments(path).map((s) => (
          <Polyline
            key={s[0].id}
            coordinates={s.map(coordinate)}
            strokeColor="#2167da"
            strokeWidth={5}
          />
        ))}
        {path.length > 1 && (
          <Marker
            coordinate={coordinate(path[path.length - 1])}
            title="마지막 기록 지점"
            pinColor="#2167da"
          />
        )}
        {startPoint && (
          <Marker
            coordinate={coordinate(startPoint)}
            anchor={{ x: 0.5, y: 1 }}
            title="출발 지점"
            zIndex={2}
          >
            <View style={styles.start}>
              <Text style={styles.label}>출발 지점</Text>
              <View style={styles.dot} />
            </View>
          </Marker>
        )}
      </MapView>
      {!drawn && <MapLoadingOverlay />}
    </View>
  );
}
const styles = StyleSheet.create({
  start: { alignItems: 'center' },
  label: {
    backgroundColor: 'white',
    color: '#174b96',
    paddingHorizontal: 6,
    borderRadius: 5,
    fontSize: 12,
    fontWeight: '700',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'white',
    backgroundColor: '#2167da',
  },
});
