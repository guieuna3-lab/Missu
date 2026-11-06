import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FormField, FormMessage, TextLink } from '@/components/FormField';
import { colors, typography } from '@/constants/theme';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { AuthScreen } from './AuthScreen';
import { login } from './mockAuthApi';
import { isEmail, requestErrorMessage } from './validation';

// Figma 02.01 (empty), 02.02 (filled) and 02-A.01 (error) are states of this screen.
export function LoginScreen() {
  const { signIn, cancelLogin, continueAfterLogin } = usePreview();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ message: string; fields: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const edit = (setValue: (value: string) => void) => (value: string) => {
    setValue(value);
    setError(null);
  };

  async function submit() {
    if (submitting) return;
    if (!isEmail(email) || !password) {
      setError({ message: '이메일 또는 비밀번호를 확인해 주세요.', fields: true });
      return;
    }
    setSubmitting(true);
    try {
      signIn(await login({ email: email.trim(), password }));
      continueAfterLogin();
    } catch (requestError) {
      setError({ message: requestErrorMessage(requestError), fields: false });
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen
      title="로그인"
      onBack={cancelLogin}
      heading="이메일로 로그인하세요"
      description="MissU 계정으로 신고와 반환을 이어가세요."
    >
      <FormField
        label="이메일"
        placeholder="이메일을 입력하세요"
        value={email}
        onChangeText={edit(setEmail)}
        error={error?.fields}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
      />
      <FormField
        label="비밀번호"
        placeholder="비밀번호를 입력하세요"
        value={password}
        onChangeText={edit(setPassword)}
        error={error?.fields}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
      />
      {error && <FormMessage>{error.message}</FormMessage>}
      <ActionButton label="로그인" onPress={submit} loading={submitting} />
      <View style={styles.links}>
        <TextLink label="회원가입" onPress={() => router.push('/signup')} />
        <Text importantForAccessibility="no" accessibilityElementsHidden style={styles.separator}>
          |
        </Text>
        <TextLink label="비밀번호 찾기" onPress={() => router.push('/password-reset')} />
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  links: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  separator: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
});
