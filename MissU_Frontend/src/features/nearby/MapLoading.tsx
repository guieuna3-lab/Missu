import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/constants/theme';

/** 지도가 그려질 때까지 지도 위를 덮는 안내. 터치는 막지 않습니다. */
export function MapLoadingOverlay() {
  return (
    <View style={styles.veil} pointerEvents="none">
      <View style={styles.card} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
        <ActivityIndicator size="large" color={colors.blue} />
        <Text style={styles.title}>지도를 불러오고 있어요</Text>
        <Text style={styles.sub}>잠시만 기다려 주세요</Text>
      </View>
    </View>
  );
}

/**
 * 지도가 다 그려졌는지 기억합니다. 신호가 오지 않아도 안내가 계속 남지 않도록
 * 일정 시간이 지나면 그려진 것으로 봅니다.
 */
export function useMapDrawn(timeoutMs = 12000) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    if (drawn) return;
    const timer = setTimeout(() => setDrawn(true), timeoutMs);
    return () => clearTimeout(timer);
  }, [drawn, timeoutMs]);
  return [drawn, () => setDrawn(true)] as const;
}

/** 지도는 그대로 쓰면서 아래쪽에 작게 띄우는 진행 안내. */
export function MapStatusPill({ label }: { label: string }) {
  return (
    <View style={styles.pillWrap} pointerEvents="none">
      <View style={styles.pill} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={colors.white} />
        <Text style={styles.pillText}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  veil: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 246, 248, 0.6)',
    zIndex: 5,
  },
  card: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: colors.white,
    shadowColor: '#171B23',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  title: { ...typography.label, fontSize: 15, fontWeight: '700' },
  sub: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  // 지도 아래쪽의 목록 보기·내 위치 버튼 위에 뜨도록 띄웁니다.
  pillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 92,
    alignItems: 'center',
    zIndex: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 10,
    paddingRight: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(23, 27, 35, 0.9)',
  },
  pillText: { ...typography.label, fontSize: 13, color: colors.white },
});
