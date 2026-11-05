import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { colors, typography } from '@/constants/theme';
import { AuthScreen } from './AuthScreen';
import { FormMessage, TextLink } from './FormField';
import { requestSignupCode } from './mockAuthApi';
import { PrivacySummary } from './PrivacySummary';
import { useSignupDraft } from './SignupDraft';
import { requestErrorMessage } from './validation';

type Message = { text: string; tone: 'info' | 'error' };

// Figma 02.03-A
export function SignupConsentScreen() {
  const signup = useSignupDraft();
  // Read once: the draft is cleared while this screen may still be closing.
  const [draft] = useState(signup.draft);
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [submitting, setSubmitting] = useState(false);
  if (!draft) return <Redirect href="/signup" />;

  const submit = async () => {
    if (submitting) return;
    if (!agreed) {
      // Figma shows a message here but its text is not exported; this wording is provisional.
      setMessage({ text: '필수 항목에 동의해 주세요.', tone: 'info' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await requestSignupCode(draft);
      router.push('/signup/verify');
    } catch (requestError) {
      setMessage({ text: requestErrorMessage(requestError), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthScreen
      title="회원가입 · 개인정보 동의"
      onBack={() => router.dismissTo('/signup')}
      heading="필요한 정보만 수집합니다"
      compact
      actions={<ActionButton label="동의하고 이메일 인증" onPress={submit} loading={submitting} />}
    >
      <PrivacySummary compact />
      <View style={styles.consentRow}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="[필수] 계정 정보 수집·이용 동의"
          accessibilityState={{ checked: agreed }}
          onPress={() => {
            setAgreed(!agreed);
            setMessage(null);
          }}
          hitSlop={12}
          style={styles.consent}
        >
          <Text style={typography.label}>{'☐  [필수] 계정 정보 수집·이용 동의'}</Text>
          {agreed && <Text style={styles.check}>✓</Text>}
        </Pressable>
        {/* Not in Figma: entry to 02-A.04, which has no incoming link there. */}
        <TextLink
          label="보기"
          accessibilityLabel="개인정보 수집 안내 보기"
          onPress={() => router.push('/privacy-notice')}
        />
      </View>
      {message && (
        <FormMessage tone={message.tone} small>
          {message.text}
        </FormMessage>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  consentRow: { minHeight: 52, paddingTop: 12, flexDirection: 'row', alignItems: 'flex-start' },
  consent: { flex: 1 },
  check: {
    position: 'absolute',
    left: 2,
    top: -2,
    fontFamily: 'NotoSansKR',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.blue,
  },
});
