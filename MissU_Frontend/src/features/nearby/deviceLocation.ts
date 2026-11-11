import * as Location from 'expo-location';
import { readFreshLocation } from './locationFix';

export async function readDeviceLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('기기 설정에서 미슈의 위치 권한을 허용해 주세요.');
  if (!(await Location.hasServicesEnabledAsync()))
    throw new Error('기기의 위치 서비스를 켜 주세요.');
  return readFreshLocation<Location.LocationObject>((onFix) =>
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 1000 },
      onFix,
    ),
  );
}

export function watchDeviceLocation(onFix: Location.LocationCallback, onError: () => void) {
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 15000 },
    onFix,
    onError,
  );
}
