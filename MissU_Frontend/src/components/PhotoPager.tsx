import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ApiPhoto } from '@/components/ApiPhoto';
import { colors, typography } from '@/constants/theme';

/** 화면 가로폭을 꽉 채운 사진. 여러 장이면 옆으로 넘기고 "n / N"을 표시합니다. */
export function PhotoPager({
  uris,
  label,
  onError,
}: {
  uris: string[];
  /** 사진 설명 앞부분. "안경케이스" → "안경케이스 사진 1" */
  label: string;
  onError?: () => void;
}) {
  const [page, setPage] = useState(0);
  // Screen은 최대 600pt 폭이라 그 안에서 꽉 차게 맞춥니다.
  const width = Math.min(useWindowDimensions().width, 600);
  const height = Math.round(width * 0.75);
  if (!uris.length) return null;
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {uris.map((uri, i) => (
          <ApiPhoto
            key={uri}
            uri={uri}
            width={width}
            height={height}
            label={`${label} 사진 ${i + 1}`}
            onError={onError}
          />
        ))}
      </ScrollView>
      {uris.length > 1 && (
        <View style={styles.badge} accessibilityLabel={`사진 ${page + 1} / ${uris.length}`}>
          <Text style={styles.badgeText}>{`${page + 1} / ${uris.length}`}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.ink },
  badge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  badgeText: { ...typography.label, fontSize: 12, lineHeight: 18, color: colors.white },
});
