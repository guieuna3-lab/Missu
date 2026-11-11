import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/constants/theme';
import { ActionBar } from './ActionButton';
import { Header } from './Header';
import { Screen } from './Screen';

// Shared frame of the step-by-step screens (02 auth, 04 report, 05 registration, 07, 08):
// header, keyboard-aware scroll content and an optional bottom action bar.
export function FlowScreen({
  title,
  onBack,
  backLabel,
  wordmark = false,
  step,
  heading,
  description,
  actions,
  children,
  compact = false,
  centered = false,
}: {
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  /** Shows the "MissU." header with the account control instead of a title (Figma 09). */
  wordmark?: boolean;
  /** Step label above the heading, such as "1 / 3" (Figma 04, 05). */
  step?: string;
  heading?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  /** 20px padding with 12px gaps (Figma 02.03-A). */
  compact?: boolean;
  /** Centers the content vertically (Figma 02.05, 04.05, 05.05). */
  centered?: boolean;
}) {
  return (
    <Screen>
      {wordmark ? <Header /> : <Header title={title} onBack={onBack} backLabel={backLabel} />}
      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            compact && styles.compact,
            centered && styles.centered,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {(step || heading) && (
            <View style={styles.headingBlock}>
              {step && <Text style={styles.step}>{step}</Text>}
              {heading && (
                <Text
                  accessibilityRole="header"
                  style={[typography.heading, centered && styles.centerText]}
                >
                  {heading}
                </Text>
              )}
            </View>
          )}
          {description && (
            <Text style={[typography.body, centered && styles.centerText]}>{description}</Text>
          )}
          {children}
        </ScrollView>
        {actions && <ActionBar>{actions}</ActionBar>}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  compact: { paddingVertical: 20, gap: 12 },
  centered: { flexGrow: 1, justifyContent: 'center' },
  headingBlock: { gap: 8 },
  step: { ...typography.label, color: colors.blue },
  centerText: { textAlign: 'center' },
});
