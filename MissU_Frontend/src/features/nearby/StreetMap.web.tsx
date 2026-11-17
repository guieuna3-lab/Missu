import 'leaflet/dist/leaflet.css';
import { lazy, Suspense, useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type * as Leaflet from 'leaflet';
import { routeSegments, type Coordinates, type StreetMapProps } from './mapData';
import { MapLoadingOverlay, useMapDrawn } from './MapLoading';

function pair(p: Coordinates): [number, number] {
  return [p.lat, p.lng];
}
const GoogleMap = lazy(() => import('./GoogleSurface.web'));
export function StreetMap(props: StreetMapProps) {
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY?.trim();
  const [unavailable, setUnavailable] = useState(false);
  if (key && !unavailable)
    return (
      <Suspense
        fallback={
          <View style={StyleSheet.absoluteFill}>
            <MapLoadingOverlay />
          </View>
        }
      >
        <GoogleMap {...props} apiKey={key} onFailure={() => setUnavailable(true)} />
      </Suspense>
    );
  return <OpenStreetMap {...props} />;
}
function OpenStreetMap(props: StreetMapProps) {
  const container = useRef<ComponentRef<typeof View>>(null);
  const firstCenter = useRef(props.center);
  const callback = useRef(props.onMove);
  const select = useRef(props.onSelect);
  const [live, setLive] = useState<{ map: Leaflet.Map; L: typeof Leaflet }>();
  const [failed, setFailed] = useState(false);
  const [drawn, markDrawn] = useMapDrawn();
  const drawnRef = useRef(markDrawn);
  useEffect(() => {
    callback.current = props.onMove;
    select.current = props.onSelect;
  }, [props.onMove, props.onSelect]);
  useEffect(() => {
    let closed = false;
    let map: Leaflet.Map | undefined;
    let observer: ResizeObserver | undefined;
    void import('leaflet')
      .then((L) => {
        const element = container.current as unknown as HTMLElement;
        if (closed || !element) return;
        const m = L.map(element, { zoomControl: false, attributionControl: true }).setView(
          pair(firstCenter.current),
          16,
        );
        map = m;
        m.attributionControl.setPrefix(false);
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        }).addTo(m);
        tiles.on('tileerror', () => {
          if (closed) return;
          setFailed(true);
          drawnRef.current();
        });
        // 처음 보이는 타일이 모두 그려지면 로딩 안내를 내립니다.
        tiles.once('load', () => {
          if (!closed) drawnRef.current();
        });
        tiles.on('tileload', () => {
          if (!closed) setFailed(false);
        });
        L.control.zoom({ position: 'bottomleft' }).addTo(m);
        m.on('moveend', () => {
          const p = m.getCenter();
          callback.current?.({ lat: p.lat, lng: p.wrap().lng });
        });
        observer = new ResizeObserver(() => {
          // 결과 목록의 높이가 달라져도 지도의 중심 좌표를 유지합니다.
          m.invalidateSize({ animate: false, pan: true });
        });
        observer.observe(element);
        setLive({ map: m, L });
      })
      .catch(() => {
        if (!closed) setFailed(true);
      });
    return () => {
      closed = true;
      observer?.disconnect();
      map?.remove();
    };
  }, []);
  const framedPath = props.fitPath ? props.path : undefined;
  useEffect(() => {
    if (!live) return;
    if (framedPath && framedPath.length > 1)
      live.map.fitBounds(framedPath.map(pair), { padding: [30, 30], maxZoom: 17, animate: false });
    else live.map.panTo(pair(props.center), { animate: false });
  }, [live, props.center, framedPath]);
  useEffect(() => {
    if (!live) return;
    const { map, L } = live;
    const group = L.layerGroup().addTo(map);
    if (props.position)
      L.circleMarker(pair(props.position), {
        radius: 7,
        weight: 3,
        color: 'white',
        fillColor: '#1875df',
        fillOpacity: 1,
      })
        .bindTooltip('내 위치')
        .addTo(group);
    for (const p of props.pins ?? []) {
      const pin = L.circleMarker(pair(p), {
        radius: 9,
        weight: 3,
        color: 'white',
        fillColor: p.id === props.selectedId ? '#ed8a19' : '#bf4132',
        fillOpacity: 1,
      }).addTo(group);
      // 물품명이 HTML로 해석되지 않게 텍스트로만 표시합니다.
      const label = map.getContainer().ownerDocument.createElement('span');
      label.textContent = p.title;
      pin.bindTooltip(label).on('click', () => select.current?.(p.id));
    }
    for (const line of routeSegments(props.path ?? [])) {
      L.polyline(line.map(pair), { color: '#2167da', weight: 5 }).addTo(group);
      L.circleMarker(pair(line[0]), { radius: 5, color: '#2167da' }).addTo(group);
      if (line.length > 1)
        L.circleMarker(pair(line[line.length - 1]), { radius: 5, color: '#2167da' }).addTo(group);
    }
    if (props.startPoint)
      L.circleMarker(pair(props.startPoint), {
        radius: 7,
        color: 'white',
        weight: 2,
        fillColor: '#2167da',
        fillOpacity: 1,
      })
        .bindTooltip('출발 지점', { permanent: true, direction: 'top', offset: [0, -7] })
        .addTo(group);
    return () => {
      group.remove();
    };
  }, [live, props.position, props.startPoint, props.pins, props.selectedId, props.path]);
  return (
    <View style={[StyleSheet.absoluteFill, { bottom: 17, zIndex: 0 }]}>
      <View ref={container} style={{ flex: 1, zIndex: 0 }} />
      {!drawn && <MapLoadingOverlay />}
      {failed && (
        <Text accessibilityRole="alert" style={{ backgroundColor: 'white' }}>
          지도에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.
        </Text>
      )}
    </View>
  );
}
