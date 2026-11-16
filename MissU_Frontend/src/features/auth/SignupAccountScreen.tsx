import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage } from '@/components/FormField';
import { checkNickname } from './authApi';
import { useSignupDraft } from './SignupDraft';
import { isEmail, PASSWORD_HINT, passwordProblem, requestErrorMessage } from './validation';

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
  // The nickname that passed 중복확인. Editing the field makes it stale.
  const [checkedNickname, setCheckedNickname] = useState<string>();
  const [checkingNickname, setCheckingNickname] = useState(false);
  // One eye button on 비밀번호 also reveals 비밀번호 확인.
  const [showPassword, setShowPassword] = useState(false);

  // Leaving the sign-up flow (back to login, or after completion) discards the draft.
  useEffect(() => () => setDraft(null), [setDraft]);

  const edit = (field: Field) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  function nicknameProblem(nickname: string) {
    if (!nickname) return '닉네임을 입력해 주세요.';
    if (nickname.length < 2 || nickname.length > 10) return '닉네임은 2~10자로 입력해 주세요.';
    return undefined;
  }

  async function verifyNickname() {
    if (checkingNickname) return;
    const nickname = values.nickname.trim();
    const problem = nicknameProblem(nickname);
    if (problem) {
      setErrors((current) => ({ ...current, nickname: problem }));
      return;
    }
    setCheckingNickname(true);
    try {
      if (await checkNickname(nickname)) setCheckedNickname(nickname);
      else setErrors((current) => ({ ...current, nickname: '이미 사용 중인 닉네임이에요.' }));
    } catch (error) {
      setErrors((current) => ({ ...current, nickname: requestErrorMessage(error) }));
    } finally {
      setCheckingNickname(false);
    }
  }

  function next() {
    const found: Partial<Record<Field, string>> = {};
    if (!isEmail(values.email)) found.email = '이메일 형식을 확인해 주세요.';
    const nickname = values.nickname.trim();
    const nicknameError =
      nicknameProblem(nickname) ??
      (checkedNickname === nickname ? undefined : '닉네임 중복확인을 해 주세요.');
    if (nicknameError) found.nickname = nicknameError;
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
        onChangeText={(value) => {
          edit('nickname')(value);
          setCheckedNickname(undefined);
        }}
        error={errors.nickname}
        action={{
          label: checkingNickname ? '확인 중' : '중복확인',
          onPress: verifyNickname,
          disabled: checkingNickname,
        }}
        autoComplete="nickname"
        textContentType="nickname"
      />
      {checkedNickname !== undefined && checkedNickname === values.nickname.trim() && (
        <FormMessage tone="info">사용할 수 있는 닉네임이에요.</FormMessage>
      )}
      <FormField
        label="비밀번호"
        required
        placeholder={PASSWORD_HINT}
        value={values.password}
        onChangeText={edit('password')}
        error={errors.password}
        reveal={{ visible: showPassword, onToggle: () => setShowPassword((shown) => !shown) }}
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
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
    </FlowScreen>
  );
}
