import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { ActionBar } from '@/components/ActionButton';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';

// Shared frame of the 02 screens: title header, keyboard-aware scroll content and
// an optional bottom action bar.
export function AuthScreen({
  title,
  onBack,
  heading,
  description,
  actions,
  children,
  compact = false,
  centered = false,
}: {
  title: string;
  onBack?: () => void;
  heading?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  /** 20px padding with 12px gaps (Figma 02.03-A). */
  compact?: boolean;
  /** Centers the content vertically (Figma 02.05). */
  centered?: boolean;
}) {
  return (
    <Screen>
      <Header title={title} onBack={onBack} />
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
          {heading && (
            <Text accessibilityRole="header" style={typography.heading}>
              {heading}
            </Text>
          )}
          {description && <Text style={typography.body}>{description}</Text>}
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
});
