import { router } from 'expo-router';
import { useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { AuthScreen } from './AuthScreen';
import { FormField, FormMessage } from './FormField';
import { requestPasswordReset } from './mockAuthApi';
import { isEmail, requestErrorMessage } from './validation';

// Figma 02-A.02
export function PasswordResetScreen() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();
  const [requestError, setRequestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    if (!isEmail(email)) {
      setEmailError('이메일 형식을 확인해 주세요.');
      return;
    }
    const sentTo = email.trim();
    setSubmitting(true);
    setRequestError(null);
    try {
      await requestPasswordReset(sentTo);
      router.push({ pathname: '/password-reset/sent', params: { email: sentTo } });
    } catch (error) {
      setRequestError(requestErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthScreen
      title="비밀번호 재설정"
      onBack={() => router.dismissTo('/login')}
      heading="비밀번호를 잊으셨나요?"
      description={'가입한 이메일로 비밀번호 재설정 안내를\n보내드립니다.'}
      actions={<ActionButton label="재설정 안내 받기" onPress={submit} loading={submitting} />}
    >
      <FormField
        label="이메일"
        placeholder="name@example.com"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          setEmailError(undefined);
        }}
        error={emailError}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        onSubmitEditing={submit}
      />
      {requestError && <FormMessage>{requestError}</FormMessage>}
    </AuthScreen>
  );
}
