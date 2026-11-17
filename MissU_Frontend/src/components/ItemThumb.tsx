import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';

// 목록·상세 표시 전용 분류입니다. 서버 분류(ELECTRONICS·WALLET_BAG·OTHER)가 거칠어서
// 물품명 키워드로 아이콘만 고릅니다. 검색·필터 값에는 쓰지 않습니다.
type Kind = 'electronics' | 'wallet' | 'card' | 'accessory' | 'key' | 'other';
const kinds: Record<Kind, { icon: IconName; tint: string; background: string }> = {
  electronics: { icon: 'cat-electronics', tint: '#2563EB', background: '#EAF2FF' },
  wallet: { icon: 'cat-wallet', tint: '#E5484D', background: '#FDEEEF' },
  card: { icon: 'cat-card', tint: '#12A150', background: '#E8F7EE' },
  accessory: { icon: 'cat-accessory', tint: '#D99A00', background: '#FFF6DB' },
  key: { icon: 'cat-key', tint: '#7C4DFF', background: '#F3EDFF' },
  other: { icon: 'cat-other', tint: '#6B7684', background: '#F1F3F5' },
};

function kindOf(name: string, category?: string): Kind {
  // 순서가 중요합니다: '카드지갑'은 지갑, '전자담배'는 전자기기가 아닙니다.
  if (/지갑|가방|백팩|파우치|쇼핑백/u.test(name)) return 'wallet';
  if (/카드|신분증|학생증|면허증|여권/u.test(name)) return 'card';
  if (/담배/u.test(name)) return 'other';
  if (/반지|목걸이|귀걸이|팔찌|시계|귀금속|안경|선글라스/u.test(name)) return 'accessory';
  if (/열쇠|키링|차키/u.test(name)) return 'key';
  if (
    /노트북|휴대폰|핸드폰|스마트폰|이어폰|버즈|에어팟|태블릿|아이패드|충전기|헤드폰|전자/u.test(
      name,
    )
  )
    return 'electronics';
  switch (category) {
    case 'ELECTRONICS':
      return 'electronics';
    case 'WALLET':
    case 'BAG':
    case 'WALLET_BAG':
      return 'wallet';
    case 'KEY':
      return 'key';
    case 'ID':
      return 'card';
    default:
      return 'other';
  }
}

/** 첨부 사진이 있으면 사진을, 없거나 불러오지 못하면 물품 종류 아이콘을 보여줍니다. */
export function ItemThumb({
  name,
  category,
  photoUrl,
  size = 46,
}: {
  name: string;
  category?: string;
  photoUrl?: string;
  size?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const kind = kinds[kindOf(name, category)];
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.3) };
  if (photoUrl && failedUrl !== photoUrl)
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[styles.photo, box]}
        contentFit="cover"
        transition={150}
        accessible={false}
        onError={() => setFailedUrl(photoUrl)}
      />
    );
  return (
    <View style={[styles.tile, box, { backgroundColor: kind.background }]}>
      <Icon name={kind.icon} size={Math.round(size * 0.52)} tintColor={kind.tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
  photo: { backgroundColor: '#F1F3F5' },
});
