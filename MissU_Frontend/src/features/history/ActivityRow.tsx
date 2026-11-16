import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';

// One 내 활동 entry on 내것: tinted icon, title with a count, one line of detail and a chevron.
// Matches the rows of the 내 활동 목록 screen it opens.
export function ActivityRow({
  icon,
  tint,
  title,
  count,
  description,
  onPress,
}: {
  icon: IconName;
  /** Pale background behind the icon. */
  tint: string;
  title: string;
  /** Hidden while the count is not known yet. */
  count?: number;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${count === undefined ? '' : ` ${count}건`}, ${description}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.icon, { backgroundColor: tint }]}>
        <Icon name={icon} size={24} />
      </View>
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <Text style={styles.title}>{title}</Text>
          {count !== undefined && (
            <Text style={[styles.count, count === 0 && styles.zero]}>{count}</Text>
          )}
        </View>
        <Text numberOfLines={1} style={styles.description}>
          {description}
        </Text>
      </View>
      <Text importantForAccessibility="no" accessibilityElementsHidden style={styles.chevron}>
        ›
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  pressed: { opacity: 0.75 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...typography.label, fontSize: 14, lineHeight: 22, fontWeight: '700' },
  count: {
    ...typography.label,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.blue,
    backgroundColor: colors.lightBlue,
    borderRadius: 999,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  zero: { color: colors.muted, backgroundColor: '#F1F3F5' },
  description: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  chevron: { ...typography.body, fontSize: 18, lineHeight: 24, color: colors.muted },
});
