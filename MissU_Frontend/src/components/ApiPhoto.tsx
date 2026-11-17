import { Image } from 'expo-image';
import { Platform, StyleSheet } from 'react-native';
import { apiBase } from '@/lib/backend';

const apiOrigin = (() => {
  try {
    return new URL(apiBase).origin;
  } catch {
    return '';
  }
})();
const isApiPhoto = (url: string) => !!apiOrigin && url.startsWith(apiOrigin + '/');

/**
 * 물품 사진 한 장. 웹에서 운영 API 사진은 출처가 달라 일반 이미지 요청이 막히므로
 * (helmet CORP) 쿠키 없는 crossOrigin 요청으로 불러옵니다. 그 밖에는 expo-image를 씁니다.
 */
export function ApiPhoto({
  uri,
  width,
  height,
  radius = 0,
  label,
  onError,
}: {
  uri: string;
  width: number;
  height: number;
  radius?: number;
  /** 비우면 장식용으로 취급해 화면 낭독기에서 건너뜁니다. */
  label?: string;
  onError?: () => void;
}) {
  if (Platform.OS === 'web' && isApiPhoto(uri))
    return (
      <img
        alt={label ?? ''}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        src={uri}
        onError={onError}
        style={{
          width,
          height,
          borderRadius: radius,
          objectFit: 'cover',
          backgroundColor: '#F1F3F5',
          flexShrink: 0,
          display: 'block',
        }}
      />
    );
  return (
    <Image
      source={{ uri }}
      style={[styles.photo, { width, height, borderRadius: radius }]}
      contentFit="cover"
      transition={150}
      accessible={!!label}
      accessibilityLabel={label}
      onError={onError}
    />
  );
}

const styles = StyleSheet.create({ photo: { backgroundColor: '#F1F3F5' } });
