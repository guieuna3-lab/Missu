import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage, TextLink } from '@/components/FormField';
import { colors, typography } from '@/constants/theme';
import { requestErrorMessage } from '@/lib/mockRequest';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { usePreview } from '@/lib/preview/PreviewProvider';
import {
  CODE_VALID_SECONDS,
  confirmPhoneCode,
  pendingPhone,
  InvalidCodeError,
  MAX_RESENDS,
  requestPhoneCode,
} from './mockPhoneApi';
import { maskPhone } from './phone';

const INVALID_CODE_MESSAGE =
  '인증번호가 다르거나 유효 시간이 지났어요.\n번호를 확인하거나 인증 문자를 다시 받아 주세요.';

function formatSeconds(total: number) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Figma 07.02 (empty), 07.03 (filled) and 07.04 (wrong or expired code).
export function PhoneCodeScreen() {
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const [phone] = useState(pendingPhone);
  const { verifyPhone, accessToken } = usePreview();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' }>();
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendsLeft, setResendsLeft] = useState(MAX_RESENDS);
  // The code expires after three minutes; the countdown restarts on every resend.
  const [issuedAt, setIssuedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, CODE_VALID_SECONDS - Math.floor((now - issuedAt) / 1000));
  const expired = remaining === 0;

  async function resend() {
    if (resending || resendsLeft === 0) return;
    setResending(true);
    setMessage(undefined);
    try {
      await requestPhoneCode(phone, accessToken);
      setResendsLeft((left) => left - 1);
      setIssuedAt(Date.now());
      setNow(Date.now());
      setError(undefined);
      // Figma shows no result for 재전송; this confirmation is provisional.
      setMessage({ text: '인증 문자를 다시 보냈어요.', tone: 'info' });
    } catch (caught) {
      setMessage({ text: requestErrorMessage(caught), tone: 'error' });
    } finally {
      setResending(false);
    }
  }

  async function submit() {
    if (submitting) return;
    if (!/^\d{6}$/.test(code)) {
      setError('6자리 인증번호를 입력해 주세요.');
      return;
    }
    if (expired) {
      setError(INVALID_CODE_MESSAGE);
      return;
    }
    setSubmitting(true);
    setMessage(undefined);
    try {
      await confirmPhoneCode({ phone, code }, accessToken);
      verifyPhone(phone);
      if (itemId) {
        router.dismissTo({ pathname: '/items/[id]', params: { id: itemId } });
        router.push({ pathname: '/requests/new', params: { itemId } });
      } else {
        leaveFlowTo('/history');
      }
    } catch (caught) {
      if (caught instanceof InvalidCodeError) setError(INVALID_CODE_MESSAGE);
      else setMessage({ text: requestErrorMessage(caught), tone: 'error' });
      setSubmitting(false);
    }
  }

  return (
    <FlowScreen
      title="휴대전화 인증"
      onBack={() => goBack('/verify-phone')}
      heading="인증번호를 입력해 주세요"
      description={`${maskPhone(phone)}으로 문자를 보냈어요.\n3분 안에 인증번호를 입력해 주세요.`}
      actions={
        <ActionButton label="인증하고 요청 작성하기" onPress={submit} loading={submitting} />
      }
    >
      <FormField
        label="6자리 인증번호"
        required
        placeholder="인증번호를 입력하세요"
        value={code}
        onChangeText={(value) => {
          setCode(value.replace(/\D/g, ''));
          setError(undefined);
        }}
        error={error}
        keyboardType="number-pad"
        maxLength={6}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        onSubmitEditing={submit}
      />
      <View style={styles.links}>
        <TextLink
          label="인증 문자 재전송"
          onPress={resend}
          accessibilityLabel={resendsLeft ? '인증 문자 재전송' : '인증 문자 재전송, 횟수 소진'}
        />
        <TextLink label="휴대전화번호 수정" onPress={() => goBack('/verify-phone')} />
      </View>
      <Text style={[typography.label, expired && styles.expired]}>
        {expired ? '인증 시간이 지났어요' : `남은 시간 ${formatSeconds(remaining)}`}
      </Text>
      <Text style={styles.muted}>
        {resendsLeft > 0 ? `재전송 ${resendsLeft}회 남음` : '재전송 횟수를 모두 사용했어요'}
      </Text>
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  links: { alignItems: 'center', gap: 12, paddingVertical: 4 },
  expired: { color: colors.danger },
  muted: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
});
