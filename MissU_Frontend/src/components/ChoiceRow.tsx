import { Pressable, StyleSheet, Text, View } from 'react-native';
import { unavailableHint } from '@/constants/messages';
import { colors, typography } from '@/constants/theme';
import { Icon, type IconName } from './Icon';

// Figma Library "Choice Row" (350×82): icon, title, one-line description and a chevron.
export function ChoiceRow({
  icon,
  title,
  description,
  onPress,
  disabled = false,
}: {
  icon: IconName;
  title: string;
  description: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const inactive = disabled || !onPress;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${description}`}
      accessibilityState={{ disabled: inactive }}
      accessibilityHint={!onPress ? unavailableHint : undefined}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Icon name={icon} size={28} />
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
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
    minHeight: 82,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  pressed: { opacity: 0.75 },
  text: { flex: 1, gap: 2 },
  title: { ...typography.label, fontSize: 14, lineHeight: 22, fontWeight: '700' },
  description: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  chevron: { ...typography.body, fontSize: 18, lineHeight: 24, color: colors.muted },
});
