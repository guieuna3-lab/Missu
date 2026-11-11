import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography } from '@/constants/theme';
import { ActionButton } from './ActionButton';

// Figma Library "Dialog / Confirm" (350×262) and the bottom sheet of 05.01-A.

function Overlay({
  onClose,
  sheet = false,
  children,
}: {
  onClose: () => void;
  sheet?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={[styles.overlay, sheet && styles.sheetOverlay]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
        />
        <View accessibilityViewIsModal style={[styles.panel, sheet && styles.sheet]}>
          {children}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  onConfirm,
  onCancel,
  loading = false,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  /** Without onCancel the dialog has a single button (Figma 01.04-S). */
  onCancel?: () => void;
  loading?: boolean;
}) {
  return (
    <Overlay onClose={onCancel ?? onConfirm}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={typography.body}>{message}</Text>
      <View style={styles.buttons}>
        {onCancel && <ActionButton label={cancelLabel} variant="outline" onPress={onCancel} />}
        <ActionButton label={confirmLabel} onPress={onConfirm} loading={loading} />
      </View>
    </Overlay>
  );
}

export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Overlay onClose={onClose} sheet>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {children}
      <ActionButton label="취소" variant="outline" onPress={onClose} style={styles.cancel} />
    </Overlay>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(23, 27, 35, 0.4)',
  },
  sheetOverlay: { justifyContent: 'flex-end', padding: 0 },
  panel: {
    width: '100%',
    maxWidth: 350,
    padding: 20,
    gap: 16,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
  sheet: {
    maxWidth: 600,
    paddingBottom: 24,
    gap: 12,
    borderRadius: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  title: { ...typography.heading, fontSize: 18, lineHeight: 28 },
  buttons: { gap: 12, marginTop: 8 },
  cancel: { borderColor: colors.blue, marginTop: 4 },
});
