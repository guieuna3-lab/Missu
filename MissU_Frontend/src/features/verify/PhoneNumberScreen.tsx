import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage } from '@/components/FormField';
import { requestErrorMessage } from '@/lib/mockRequest';
import { goBack } from '@/lib/navigation';
import { requestPhoneCode } from './mockPhoneApi';
import { isPhoneNumber, normalizePhone } from './phone';

// Figma 07.01 and 07.01-E (format error).
export function PhoneNumberScreen() {
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string>();
  const [requestError, setRequestError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    if (!isPhoneNumber(phone)) {
      setError('휴대전화번호 형식을 확인해 주세요.');
      return;
    }
    setSubmitting(true);
    setRequestError(undefined);
    const normalized = normalizePhone(phone);
    try {
      await requestPhoneCode(normalized);
      router.push({ pathname: '/verify-phone/code', params: { phone: normalized, itemId } });
    } catch (caught) {
      setRequestError(requestErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FlowScreen
      title="휴대전화 인증"
      onBack={() => goBack('/history')}
      heading={'반환 진행 전\n휴대전화를 확인해요'}
      actions={<ActionButton label="인증 문자 받기" onPress={submit} loading={submitting} />}
    >
      <FormField
        label="휴대전화번호"
        required
        placeholder="010-0000-0000"
        value={phone}
        onChangeText={(value) => {
          setPhone(value);
          setError(undefined);
        }}
        error={error}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        onSubmitEditing={submit}
      />
      <Card title="개인정보 보호" blue accent>
        {'번호는 다른 이용자에게 공개하지 않습니다.\n문자 인증 후 주인 확인 요청을 작성합니다.'}
      </Card>
      {requestError && <FormMessage>{requestError}</FormMessage>}
    </FlowScreen>
  );
}
