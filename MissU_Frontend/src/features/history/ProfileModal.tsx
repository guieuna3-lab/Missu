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

export function ProfileModal({
  profile,
  onSave,
  onClose,
}: {
  profile: Profile;
  onSave: (profile: Profile) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
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
              <Text style={typography.label}>이름</Text>
              <TextInput
                accessibilityLabel="이름"
                value={name}
                onChangeText={setName}
                style={styles.input}
                autoComplete="name"
              />
            </View>
            <View style={styles.field}>
              <Text style={typography.label}>이메일</Text>
              <TextInput
                accessibilityLabel="이메일"
                value={email}
                onChangeText={setEmail}
                style={styles.input}
                autoComplete="email"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <ActionButton label="저장" onPress={() => onSave({ name, email })} />
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
});
