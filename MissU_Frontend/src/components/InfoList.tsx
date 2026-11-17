import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';

/** 상세·확인 화면의 정보 줄을 담는 흰 카드. */
export function InfoCard({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

/** 아이콘 · 이름 · 값(+보조 문구) 한 줄. 카드의 마지막 줄은 last로 구분선을 뺍니다. */
export function InfoRow({
  icon,
  label,
  value,
  sub,
  last = false,
}: {
  icon: IconName;
  label: string;
  value: string;
  sub?: string;
  last?: boolean;
}) {
  return (
    <View
      style={[styles.row, last && styles.rowLast]}
      accessible
      accessibilityLabel={[label, value, sub].filter(Boolean).join(', ')}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} tintColor={colors.body} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowValue}>{value}</Text>
        {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
    </View>
  );
}

/** 번호가 붙은 안내 단계 상자. */
export function StepGuide({ title, steps }: { title: string; steps: string[] }) {
  return (
    <View style={styles.guide}>
      <Text style={styles.guideTitle}>{title}</Text>
      {steps.map((text, index) => (
        <View key={text} style={styles.step}>
          <View style={styles.stepNo}>
            <Text style={styles.stepNoText}>{index + 1}</Text>
          </View>
          <Text style={styles.stepText}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

const chipTones = {
  gray: { color: '#4E5968', backgroundColor: '#F2F4F6' },
  green: { color: '#0E9F6E', backgroundColor: colors.greenBg },
  blue: { color: colors.blue, backgroundColor: colors.lightBlue },
} as const;

/** 상태·분류 등을 나타내는 작은 알약 모양 표시. */
export function Chip({ label, tone = 'gray' }: { label: string; tone?: keyof typeof chipTones }) {
  return (
    <View style={[styles.chip, { backgroundColor: chipTones[tone].backgroundColor }]}>
      <Text style={[styles.chipText, { color: chipTones[tone].color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F4F6',
  },
  rowLabel: { ...typography.body, width: 64, color: colors.muted },
  rowBody: { flex: 1, gap: 1 },
  rowValue: { ...typography.label, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  rowSub: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  guide: { backgroundColor: colors.lightBlue, borderRadius: 16, padding: 18, gap: 8 },
  guideTitle: { ...typography.label, fontSize: 14, fontWeight: '700', color: colors.blue },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNo: {
    width: 21,
    height: 21,
    borderRadius: 11,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  stepNoText: {
    ...typography.label,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.white,
  },
  stepText: { ...typography.body, flex: 1, fontSize: 14, lineHeight: 22, color: '#334155' },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, maxWidth: '100%' },
  chipText: { ...typography.label, fontSize: 12, lineHeight: 18, fontWeight: '700' },
});
