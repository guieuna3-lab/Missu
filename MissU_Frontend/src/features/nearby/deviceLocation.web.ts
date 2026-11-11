import { readFreshLocation } from './locationFix';

// 브라우저의 오래된 마지막 위치를 출발점으로 사용하지 않습니다.
const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };

function geolocation() {
  if (!globalThis.isSecureContext || !navigator.geolocation)
    throw new Error('위치를 사용하려면 노트북에서 localhost 주소 또는 HTTPS로 열어 주세요.');
  return navigator.geolocation;
}

export function readDeviceLocation(): Promise<GeolocationPosition> {
  return readFreshLocation<GeolocationPosition>((onFix, reject) =>
    watchDeviceLocation(onFix, (error) => {
      // 신호가 잠시 끊겨도 브라우저가 이어서 더 정확한 좌표를 줄 수 있습니다.
      if (error.code === error.PERMISSION_DENIED)
        reject(new Error('브라우저와 기기 설정에서 미슈의 위치 권한을 허용해 주세요.'));
    }),
  );
}

export async function watchDeviceLocation(onFix: PositionCallback, onError: PositionErrorCallback) {
  const geo = geolocation();
  const id = geo.watchPosition(onFix, onError, options);
  return { remove: () => geo.clearWatch(id) };
}
