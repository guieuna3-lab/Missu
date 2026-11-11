import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage, TextLink } from '@/components/FormField';
import { Card } from '@/components/Card';
import { requestPasswordReset, resetEmail, verifyResetCode } from './passwordResetApi';
import { requestErrorMessage } from './validation';

type Message = { text: string; tone: 'info' | 'error' };

// Figma 02-A.03
export function PasswordResetSentScreen() {
  const email = resetEmail();
  const [code, setCode] = useState(''),
    [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [resending, setResending] = useState(false);
  if (!email) return <Redirect href="/password-reset" />;

  async function verify() {
    if (verifying || resending) return;
    setVerifying(true);
    setMessage(null);
    try {
      await verifyResetCode(code);
      router.push({ pathname: '/account/password', params: { mode: 'reset' } });
    } catch (e) {
      setMessage({ text: requestErrorMessage(e), tone: 'error' });
    } finally {
      setVerifying(false);
    }
  }
  async function resend() {
    if (!email || verifying || resending) return;
    setResending(true);
    setMessage(null);
    try {
      await requestPasswordReset(email);
      setCode('');
      // Figma shows a message here but its text is not exported; this wording is provisional.
      setMessage({ text: '재설정 안내를 다시 보냈습니다.', tone: 'info' });
    } catch (error) {
      setMessage({ text: requestErrorMessage(error), tone: 'error' });
    } finally {
      setResending(false);
    }
  }

  return (
    <FlowScreen
      title="비밀번호 재설정"
      onBack={() => router.dismissTo('/password-reset')}
      heading="이메일을 확인해 주세요"
      description="입력한 이메일로 비밀번호 재설정 안내를 보냈습니다."
      actions={
        <ActionButton
          label="인증하고 새 비밀번호 입력"
          onPress={verify}
          loading={verifying}
          disabled={resending || code.length !== 6}
        />
      }
    >
      <FormField
        label="발송한 이메일"
        value={email}
        editable={false}
        action={{ label: '재전송', onPress: resend, disabled: resending }}
      />
      <FormField
        label="6자리 인증 코드"
        value={code}
        onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={6}
        onSubmitEditing={verify}
      />
      <Card title="메일이 오지 않았나요?">
        스팸함을 확인하거나 이메일 주소를 다시 확인해 주세요.
      </Card>
      {/* Figma keeps this message row even when empty. */}
      <View style={styles.message}>
        {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
      </View>
      <View style={styles.center}>
        <TextLink label="이메일 주소 수정" onPress={() => router.dismissTo('/password-reset')} />
      </View>
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  message: { minHeight: 20 },
  center: { alignItems: 'center' },
});
