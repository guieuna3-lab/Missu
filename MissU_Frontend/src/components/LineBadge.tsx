import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/constants/theme';

// 서울 지하철 노선색입니다.
const lineColors: Record<string, string> = {
  '1': '#0052A4',
  '2': '#00A84D',
  '3': '#EF7C1C',
  '4': '#00A5DE',
  '5': '#996CAC',
  '6': '#CD7C2F',
  '7': '#747F00',
  '8': '#E6186C',
  '9': '#BDB092',
};

/** 지하철 보관처 "혜화역(4호선)" → { line: '4', station: '혜화역' }. 그 밖에는 null */
export function subwayStop(source: string | undefined, storage: string) {
  if (source !== '지하철') return null;
  const m = storage.match(/^(.+?)\s*\((\d)호선\)$/u);
  return m && lineColors[m[2]] ? { station: m[1], line: m[2] } : null;
}

export function LineBadge({ line, size = 18 }: { line: string; size?: number }) {
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: lineColors[line] },
      ]}
    >
      <Text style={[styles.text, { fontSize: Math.round(size * 0.6) }]}>{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
  text: { ...typography.label, lineHeight: 14, fontWeight: '700', color: colors.white },
});
