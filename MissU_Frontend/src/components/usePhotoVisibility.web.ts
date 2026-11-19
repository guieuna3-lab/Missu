import { useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import type { View } from 'react-native';

/** 화면 가까이에 온 물품부터 사진 주소와 파일을 조회해 현재 보이는 사진을 우선합니다. */
export function usePhotoVisibility() {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [ready, setReady] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    // React Native Web의 View 참조는 실제 DOM 요소입니다.
    const element = ref.current as unknown as Element | null;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setReady(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, ready };
}
