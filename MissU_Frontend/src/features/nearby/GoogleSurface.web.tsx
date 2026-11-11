/// <reference types="google.maps" />
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { routeSegments, type StreetMapProps } from './mapData';

// 지도 키가 설정된 웹에서만 Google의 지도 코드를 불러옵니다.
type Props = StreetMapProps & { apiKey: string; onFailure: () => void };
export default function GoogleSurface(props: Props) {
  const container = useRef<ComponentRef<typeof View>>(null);
  const current = useRef(props);
  const [map, setMap] = useState<google.maps.Map>();
  useEffect(() => {
    current.current = props;
  }, [props]);
  useEffect(() => {
    let closed = false;
    let listener: google.maps.MapsEventListener | undefined;
    const scope = globalThis as typeof globalThis & { gm_authFailure?: () => void };
    const oldFailure = scope.gm_authFailure;
    const failed = () => {
      if (!closed) current.current.onFailure();
    };
    scope.gm_authFailure = failed;
    setOptions({ key: props.apiKey, language: 'ko', region: 'KR' });
    void importLibrary('maps')
      .then(({ Map }) => {
        if (closed || !container.current) return;
        const next = new Map(container.current as unknown as HTMLElement, {
          center: current.current.center,
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        listener = next.addListener('idle', () => {
          const c = next.getCenter();
          if (c) current.current.onMove?.(c.toJSON());
        });
        setMap(next);
      })
      .catch(failed);
    return () => {
      closed = true;
      listener?.remove();
      if (scope.gm_authFailure === failed) scope.gm_authFailure = oldFailure;
    };
  }, [props.apiKey]);
  const framedPath = props.fitPath ? props.path : undefined;
  useEffect(() => {
    if (!map) return;
    if (framedPath && framedPath.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      framedPath.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 32);
    } else map.panTo(props.center);
  }, [map, props.center, framedPath]);
  useEffect(() => {
    if (!map) return;
    const layers: (google.maps.Circle | google.maps.Polyline)[] = [];
    const dot = (p: { lat: number; lng: number }, color: string, radius: number) => {
      const layer = new google.maps.Circle({
        map,
        center: p,
        radius,
        fillColor: color,
        fillOpacity: 0.95,
        strokeColor: '#ffffff',
        strokeWeight: 2,
      });
      layers.push(layer);
      return layer;
    };
    if (props.position) dot(props.position, '#1875df', 8);
    for (const p of props.pins ?? [])
      dot(p, p.id === props.selectedId ? '#ed8a19' : '#bf4132', 12).addListener('click', () =>
        current.current.onSelect?.(p.id),
      );
    for (const line of routeSegments(props.path ?? [])) {
      layers.push(
        new google.maps.Polyline({ map, path: line, strokeColor: '#2167da', strokeWeight: 5 }),
      );
      dot(line[0], '#2167da', 6);
    }
    let startLabel: google.maps.InfoWindow | undefined;
    if (props.startPoint) {
      dot(props.startPoint, '#2167da', 7);
      startLabel = new google.maps.InfoWindow({
        position: props.startPoint,
        content: '출발 지점',
        disableAutoPan: true,
        headerDisabled: true,
      });
      startLabel.open({ map, shouldFocus: false });
    }
    return () => {
      startLabel?.close();
      for (const layer of layers) {
        google.maps.event.clearInstanceListeners(layer);
        layer.setMap(null);
      }
    };
  }, [map, props.position, props.startPoint, props.pins, props.path, props.selectedId]);
  return <View ref={container} style={[StyleSheet.absoluteFill, { bottom: 17 }]} />;
}
