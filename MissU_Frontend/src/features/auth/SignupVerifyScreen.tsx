import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FormField, FormMessage } from '@/components/FormField';
import { typography } from '@/constants/theme';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { AuthScreen } from './AuthScreen';
import { confirmSignup, resendSignupCode } from './mockAuthApi';
import { useSignupDraft } from './SignupDraft';
import { isVerificationCode, requestErrorMessage } from './validation';

type Message = { text: string; tone: 'info' | 'error' };

// Figma 02.04
export function SignupVerifyScreen() {
  const signup = useSignupDraft();
  // Read once: the draft is cleared while this screen may still be closing.
  const [draft] = useState(signup.draft);
  const { completeSignup } = usePreview();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  const [message, setMessage] = useState<Message | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  if (!draft) return <Redirect href="/signup" />;

  const resend = async () => {
    setResending(true);
    setMessage(null);
    try {
      await resendSignupCode(draft.email);
      // Figma has no visible result for 재전송; this confirmation is provisional.
      setMessage({ text: '인증 코드를 다시 보냈습니다.', tone: 'info' });
    } catch (requestError) {
      setMessage({ text: requestErrorMessage(requestError), tone: 'error' });
    } finally {
      setResending(false);
    }
  };

  const submit = async () => {
    if (submitting) return;
    if (!isVerificationCode(code)) {
      setCodeError('6자리 인증 코드를 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      completeSignup(await confirmSignup({ email: draft.email, nickname: draft.nickname, code }));
    } catch (requestError) {
      setMessage({ text: requestErrorMessage(requestError), tone: 'error' });
      setSubmitting(false);
    }
  };

  return (
    <AuthScreen
      title="이메일 인증"
      onBack={() => router.dismissTo('/signup')}
      heading="이메일을 확인할게요"
      description={`${draft.email}으로 인증 코드를 보냈습니다.\n5분 안에 입력해 주세요.`}
      actions={<ActionButton label="인증하고 가입 완료" onPress={submit} loading={submitting} />}
    >
      <FormField
        label="6자리 인증 코드"
        required
        placeholder="123456"
        value={code}
        onChangeText={(value) => {
          setCode(value.replace(/\D/g, ''));
          setCodeError(undefined);
        }}
        error={codeError}
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        onSubmitEditing={submit}
        action={{ label: '재전송', onPress: resend, disabled: resending }}
      />
      <Text style={typography.body}>이메일은 로그인과 비밀번호 찾기에 사용됩니다.</Text>
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
    </AuthScreen>
  );
}
