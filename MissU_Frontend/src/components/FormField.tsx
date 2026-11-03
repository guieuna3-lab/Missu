import { useId } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { colors, typography } from '@/constants/theme';

export function FormField({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const id = useId();
  return (
    <View style={styles.field}>
      <Text nativeID={id} style={typography.label}>
        {label}
      </Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        accessibilityLabelledBy={id}
        placeholderTextColor={colors.body}
        style={[typography.body, styles.input, error ? styles.invalid : undefined]}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={[typography.body, styles.error]}>
          {error}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  field: { gap: 8 },
  input: {
    color: colors.ink,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  invalid: { borderColor: colors.error },
  error: { color: colors.error },
});
