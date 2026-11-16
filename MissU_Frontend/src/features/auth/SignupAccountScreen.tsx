import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField } from '@/components/FormField';
import { useSignupDraft } from './SignupDraft';
import { isEmail, PASSWORD_HINT, passwordProblem } from './validation';

type Field = 'email' | 'nickname' | 'password' | 'confirm';

// Figma 02.03
export function SignupAccountScreen() {
  const { setDraft } = useSignupDraft();
  const [values, setValues] = useState<Record<Field, string>>({
    email: '',
    nickname: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  // Leaving the sign-up flow (back to login, or after completion) discards the draft.
  useEffect(() => () => setDraft(null), [setDraft]);

  const edit = (field: Field) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  function next() {
    const found: Partial<Record<Field, string>> = {};
    if (!isEmail(values.email)) found.email = '이메일 형식을 확인해 주세요.';
    if (!values.nickname.trim()) found.nickname = '닉네임을 입력해 주세요.';
    const passwordError = passwordProblem(values.password);
    if (passwordError) found.password = passwordError;
    if (values.confirm !== values.password) found.confirm = '비밀번호가 일치하지 않아요.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setDraft({
      email: values.email.trim(),
      nickname: values.nickname.trim(),
      password: values.password,
    });
    router.push('/signup/consent');
  }

  return (
    <FlowScreen
      title="회원가입"
      onBack={() => router.dismissTo('/login')}
      heading="누구나 MissU와 함께해요"
      description="사용 중인 이메일로 가입할 수 있습니다."
      actions={<ActionButton label="다음 · 약관 및 개인정보 동의" onPress={next} />}
    >
      <FormField
        label="이메일"
        required
        placeholder="missu@example.com"
        value={values.email}
        onChangeText={edit('email')}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
      />
      <FormField
        label="닉네임"
        required
        placeholder="홍길동"
        value={values.nickname}
        onChangeText={edit('nickname')}
        error={errors.nickname}
        autoComplete="nickname"
        textContentType="nickname"
      />
      <FormField
        label="비밀번호"
        required
        placeholder={PASSWORD_HINT}
        value={values.password}
        onChangeText={edit('password')}
        error={errors.password}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <FormField
        label="비밀번호 확인"
        required
        placeholder="비밀번호를 다시 입력하세요"
        value={values.confirm}
        onChangeText={edit('confirm')}
        error={errors.confirm}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
    </FlowScreen>
  );
}
