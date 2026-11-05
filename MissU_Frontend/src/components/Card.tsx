import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { unavailableHint } from '@/constants/messages';
import { colors, typography } from '@/constants/theme';

export function Card({
  title,
  children,
  blue = false,
  onPress,
  disabled = false,
  centered = false,
  accent = false,
}: {
  title: string;
  children: ReactNode;
  blue?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  centered?: boolean;
  /** Shows the title in the accent color. */
  accent?: boolean;
}) {
  const content = (
    <>
      <Text
        style={[typography.label, centered && styles.centerText, accent && { color: colors.blue }]}
      >
        {title}
      </Text>
      <Text style={[typography.body, centered && styles.centerText]}>{children}</Text>
    </>
  );
  const style = [styles.card, blue && { backgroundColor: colors.lightBlue }];
  if (onPress || disabled)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityHint={disabled ? unavailableHint : undefined}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [style, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  return <View style={style}>{content}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 16, gap: 8 },
  centerText: { textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
