import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { unavailableHint } from '@/constants/messages';
import { colors, typography } from '@/constants/theme';

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  style,
  large = false,
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'white' | 'plain';
  style?: StyleProp<ViewStyle>;
  large?: boolean;
  /** A request is in progress. Blocks repeated taps until it settles. */
  loading?: boolean;
  /** The form is incomplete (Figma 05.01). Unlike a missing onPress, this is not "out of scope". */
  disabled?: boolean;
}) {
  const unavailable = !onPress;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: unavailable || loading || disabled, busy: loading }}
      accessibilityHint={unavailable ? unavailableHint : undefined}
      disabled={unavailable || loading || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant !== 'primary' && styles.white,
        variant === 'outline' && styles.outline,
        large && styles.largeButton,
        (pressed || loading) && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.white : colors.blue} />
      ) : (
        <Text
          style={[
            typography.action,
            variant !== 'primary' && { color: variant === 'white' ? colors.blue : colors.ink },
            large && { fontSize: 15, lineHeight: 24 },
            disabled && styles.disabledText,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <View style={styles.actionBar}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  white: { backgroundColor: colors.white },
  largeButton: { minHeight: 56, borderRadius: 14 },
  outline: { borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: 0.75 },
  disabled: { backgroundColor: '#DCE6F7' },
  disabledText: { color: colors.muted },
  actionBar: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: colors.white,
    borderTopWidth: 0.5,
    borderColor: colors.border,
  },
});
