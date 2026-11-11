import { useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage } from '@/components/FormField';
import { changePassword } from '@/features/auth/mockAuthApi';
import { MIN_PASSWORD_LENGTH, requestErrorMessage } from '@/features/auth/validation';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { usePreview } from '@/lib/preview/PreviewProvider';

// Figma 02-A.05, reached from 계정 관리. After the change the design returns to the login
// screen, so the mock session ends here as well.
export function NewPasswordScreen() {
  const { exitMemberPreview } = usePreview();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [requestError, setRequestError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    const next: typeof errors = {};
    if (password.length < MIN_PASSWORD_LENGTH)
      next.password = `비밀번호를 ${MIN_PASSWORD_LENGTH}자 이상 입력해 주세요.`;
    if (confirm !== password) next.confirm = '비밀번호가 일치하지 않아요.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    setRequestError(undefined);
    try {
      await changePassword({ password });
      exitMemberPreview();
      leaveFlowTo('/login');
    } catch (caught) {
      setRequestError(requestErrorMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <FlowScreen
      title="비밀번호 변경"
      onBack={() => goBack('/account')}
      heading="새 비밀번호를 입력해 주세요"
      actions={<ActionButton label="비밀번호 변경" onPress={submit} loading={submitting} />}
    >
      <FormField
        label="새 비밀번호"
        required
        placeholder={`${MIN_PASSWORD_LENGTH}자 이상`}
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          setErrors((current) => ({ ...current, password: undefined }));
        }}
        error={errors.password}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
      />
      <FormField
        label="새 비밀번호 확인"
        required
        placeholder="비밀번호를 다시 입력하세요"
        value={confirm}
        onChangeText={(value) => {
          setConfirm(value);
          setErrors((current) => ({ ...current, confirm: undefined }));
        }}
        error={errors.confirm}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={submit}
      />
      {requestError && <FormMessage>{requestError}</FormMessage>}
    </FlowScreen>
  );
}
