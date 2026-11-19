import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ApiPhoto } from '@/components/ApiPhoto';
import { ItemThumb } from '@/components/ItemThumb';
import { colors, typography } from '@/constants/theme';

/** 화면 가로폭을 꽉 채운 사진. 여러 장이면 옆으로 넘기고 "n / N"을 표시합니다. */
export function PhotoPager({
  uris,
  label,
  onError,
  category,
}: {
  uris: string[];
  /** 사진 설명 앞부분. "안경케이스" → "안경케이스 사진 1" */
  label: string;
  onError?: () => void;
  category?: string;
}) {
  const [page, setPage] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const shown = uris.filter((uri) => !failed.includes(uri));
  // Screen은 최대 600pt 폭이라 그 안에서 꽉 차게 맞춥니다.
  const width = Math.min(useWindowDimensions().width, 600);
  const height = Math.round(width * 0.75);
  if (!uris.length) return null;
  if (!shown.length)
    return (
      <View style={styles.fallback}>
        <ItemThumb name={label} category={category} size={64} />
        <Text style={styles.failureText}>사진을 불러오지 못했어요.</Text>
      </View>
    );
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {shown.map((uri, i) => (
          <ApiPhoto
            key={uri}
            uri={uri}
            width={width}
            height={height}
            label={`${label} 사진 ${i + 1}`}
            onError={() => {
              setFailed((old) => (old.includes(uri) ? old : [...old, uri]));
              setPage(0);
              onError?.();
            }}
          />
        ))}
      </ScrollView>
      {shown.length > 1 && (
        <View
          style={styles.badge}
          accessibilityLabel={`사진 ${Math.min(page + 1, shown.length)} / ${shown.length}`}
        >
          <Text
            style={styles.badgeText}
          >{`${Math.min(page + 1, shown.length)} / ${shown.length}`}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { padding: 24, alignItems: 'center', gap: 12, backgroundColor: colors.white },
  failureText: { ...typography.body, color: colors.muted },
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
