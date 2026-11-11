import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { colors, typography } from '@/constants/theme';
import type { Profile } from '@/lib/preview/fixtures';

// Figma 01.05-A: the nickname can change; the email is the login id and stays read-only.
export function ProfileModal({
  profile,
  onSave,
  onClose,
}: {
  profile: Profile;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [error, setError] = useState<string>();

  function save() {
    if (!name.trim()) {
      setError('닉네임을 입력해 주세요.');
      return;
    }
    onSave(name.trim());
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
          <View accessibilityViewIsModal style={styles.modal}>
            <Text accessibilityRole="header" style={styles.heading}>
              프로필 정보 수정
            </Text>
            <View style={styles.field}>
              <Text style={typography.label}>닉네임</Text>
              <TextInput
                accessibilityLabel="닉네임"
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  setError(undefined);
                }}
                style={[styles.input, error && styles.inputError]}
                autoComplete="nickname"
                onSubmitEditing={save}
              />
              {error && <Text style={styles.error}>{error}</Text>}
            </View>
            <View style={styles.field}>
              <Text style={typography.label}>이메일</Text>
              <View
                accessibilityLabel={`이메일, ${profile.email}, 변경 불가`}
                style={styles.readOnly}
              >
                <Text style={typography.body}>{profile.email}</Text>
              </View>
            </View>
            <ActionButton label="저장" onPress={save} />
            <Text style={styles.note}>이메일은 변경할 수 없어요</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1 },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  modal: {
    width: '100%',
    maxWidth: 350,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 20,
    gap: 16,
  },
  heading: { ...typography.heading, fontSize: 18, lineHeight: 28 },
  field: { gap: 8 },
  input: {
    ...typography.body,
    color: colors.ink,
    height: 52,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.background,
  },
  inputError: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg },
  error: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.danger },
  readOnly: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: colors.line,
  },
  note: {
    ...typography.body,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.muted,
  },
});
