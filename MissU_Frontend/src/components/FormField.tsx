import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, typography } from '@/constants/theme';
import { Icon } from './Icon';

export function FormField({
  label,
  required = false,
  error,
  action,
  reveal,
  hint,
  ...input
}: TextInputProps & {
  label: string;
  required?: boolean;
  /** `true` marks the field only. A string also shows the message below it. */
  error?: boolean | string;
  /** Text action inside the field, such as 재전송. */
  action?: { label: string; onPress: () => void; disabled?: boolean };
  /**
   * Password field with an eye button. `visible` shows the whole text; the parent owns the
   * state so one button can also reveal a paired confirm field.
   */
  reveal?: { visible: boolean; onToggle: () => void };
  /** Short guidance shown under the label, such as how freely the field can be filled. */
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      <Text importantForAccessibility="no" accessibilityElementsHidden style={typography.label}>
        {required ? `${label} *` : label}
      </Text>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      <View style={[styles.box, !!error && styles.boxError]}>
        <TextInput
          accessibilityLabel={required ? `${label}, 필수` : label}
          placeholderTextColor={colors.body}
          style={styles.input}
          {...input}
          {...(reveal && { secureTextEntry: !reveal.visible })}
        />
        {reveal && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reveal.visible ? '비밀번호 숨기기' : '비밀번호 보기'}
            onPress={reveal.onToggle}
            hitSlop={12}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Icon name={reveal.visible ? 'eye' : 'eye-off'} />
          </Pressable>
        )}
        {action && (
          <>
            <View style={styles.divider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ disabled: !!action.disabled }}
              disabled={action.disabled}
              onPress={action.onPress}
              hitSlop={12}
              style={({ pressed }) => [
                styles.action,
                (pressed || action.disabled) && styles.pressed,
              ]}
            >
              <Text style={[typography.body, { color: colors.blue }]}>{action.label}</Text>
            </Pressable>
          </>
        )}
      </View>
      {typeof error === 'string' && <FormMessage>{error}</FormMessage>}
    </View>
  );
}

export function FormMessage({
  children,
  tone = 'error',
  small = false,
}: {
  children: ReactNode;
  tone?: 'error' | 'info';
  small?: boolean;
}) {
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[
        typography.body,
        small && styles.small,
        { color: tone === 'error' ? colors.danger : colors.blue },
      ]}
    >
      {children}
    </Text>
  );
}

export function TextLink({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Text style={[typography.label, { color: colors.blue }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  box: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  boxError: {
    borderWidth: 1.5,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  input: {
    ...typography.body,
    flex: 1,
    alignSelf: 'stretch',
    paddingVertical: 0,
    textAlignVertical: 'center',
    color: colors.ink,
  },
  divider: { width: 1, height: 18, backgroundColor: colors.divider },
  action: { minWidth: 56, alignItems: 'center' },
  small: { fontSize: 12, lineHeight: 18 },
  hint: { ...typography.body, fontSize: 12, lineHeight: 18, marginTop: -4 },
  pressed: { opacity: 0.75 },
});
