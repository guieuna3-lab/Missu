import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from '../auth/auth.dto';
import { ResetPasswordDto, SignupDto } from '../auth/registration.dto';
import { ChangePasswordDto } from '../users/users.dto';

const proof = {
  challengeId: '00000000-0000-4000-8000-000000000000',
  proof: 'a'.repeat(64),
};
const signup = (password: string) => ({
  ...proof,
  email: 'rule@missu.test',
  nickname: '규칙시험',
  password,
  consents: [
    { kind: 'TERMS', policyVersion: 'dev-v1', agreed: true },
    { kind: 'PRIVACY', policyVersion: 'dev-v1', agreed: true },
  ],
});
const failedFields = async (cls: new () => object, body: object) =>
  (await validate(plainToInstance(cls, body))).map((error) => error.property);

// 새 비밀번호 규칙(12~128자, 영문·숫자·특수문자 각 1개 이상, ASCII 키보드 문자만)
describe('new password rule', () => {
  const valid = [
    'Missu-test-password-2026!',
    'abcdefghij1~',
    'x9' + '-'.repeat(126),
  ];
  const invalid = [
    'Ab1!',
    'abcdefghijkl',
    'abcdefghijk1',
    '123456789!!!',
    'missu 2026 pass!',
    '미슈비밀번호입니다a1!',
    'missu2026pass!😀',
    'a1!' + 'b'.repeat(126),
  ];

  it('applies to sign-up, reset and change', async () => {
    for (const password of valid) {
      expect(await failedFields(SignupDto, signup(password))).toEqual([]);
      expect(
        await failedFields(ResetPasswordDto, {
          ...proof,
          newPassword: password,
        }),
      ).toEqual([]);
      expect(
        await failedFields(ChangePasswordDto, {
          currentPassword: 'old-password-without-rule',
          newPassword: password,
        }),
      ).toEqual([]);
    }
    for (const password of invalid) {
      expect(await failedFields(SignupDto, signup(password))).toEqual([
        'password',
      ]);
      expect(
        await failedFields(ResetPasswordDto, {
          ...proof,
          newPassword: password,
        }),
      ).toEqual(['newPassword']);
    }
  });

  it('keeps login and current password at the length check for existing accounts', async () => {
    expect(
      await failedFields(LoginDto, {
        email: 'old@missu.test',
        password: '예전비밀번호는한글도됐어요',
      }),
    ).toEqual([]);
  });
});
