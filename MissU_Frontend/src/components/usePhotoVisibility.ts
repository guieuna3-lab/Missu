import { useRef } from 'react';
import type { ComponentRef } from 'react';
import type { View } from 'react-native';

// 네이티브 목록은 기존 렌더링 시점을 따릅니다. 웹은 별도 파일에서 화면 진입을 관찰합니다.
export function usePhotoVisibility() {
  return { ref: useRef<ComponentRef<typeof View>>(null), ready: true };
}
