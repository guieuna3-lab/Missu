import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import type { PressableProps } from 'react-native';
import { colors, typography } from '@/constants/theme';

type Props = Omit<PressableProps, 'children' | 'style'> & {
  children: string;
  variant?: 'primary' | 'outline';
  loading?: boolean;
};
export function Button({
  children,
  variant = 'primary',
  loading = false,
  disabled,
  ...props
}: Props) {
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' ? styles.primary : styles.outline,
        (disabled || loading || pressed) && styles.dim,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.white : colors.blue} />
      ) : (
        <Text style={[typography.action, styles.text, variant === 'primary' && styles.white]}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.blue },
  outline: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  text: { textAlign: 'center' },
  white: { color: colors.white },
  dim: { opacity: 0.6 },
});
