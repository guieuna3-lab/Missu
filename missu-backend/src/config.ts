/**
 * 서버 설정을 한곳에서 읽습니다. DB 비밀번호와 암호화 키는 코드가 아닌 .env에 보관합니다.
 * 설정이 없으면 임의의 기본 비밀번호를 사용하지 않고 시작을 중단합니다.
 */
import 'dotenv/config';

function secret(name: string) {
  const value = process.env[name];
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(
      `${name}: 32바이트 hex 키가 필요합니다. npm run local:setup을 실행하세요.`,
    );
  }
  return Buffer.from(value, 'hex');
}

export function config() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      'DATABASE_URL이 없습니다. npm run local:setup을 실행하세요.',
    );
  const production = process.env.NODE_ENV === 'production';
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (
    !Number.isInteger(trustProxyHops) ||
    trustProxyHops < 0 ||
    trustProxyHops > 2
  )
    throw new Error('TRUST_PROXY_HOPS는 0~2의 정수여야 합니다.');
  const origins = (
    process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:5173'
  ).split(',');
  if (production && origins.some((x) => !x.startsWith('https://'))) {
    throw new Error('운영 환경은 HTTPS Origin을 설정해야 합니다.');
  }
  const emailProvider = process.env.EMAIL_PROVIDER ?? 'local';
  const smsProvider = process.env.SMS_PROVIDER ?? 'local';
  const storageProvider = process.env.STORAGE_PROVIDER ?? 'local';
  const placeProvider = process.env.PLACE_PROVIDER ?? 'disabled';
  if (
    !['local', 'resend'].includes(emailProvider) ||
    !['local', 'solapi'].includes(smsProvider) ||
    !['local', 'supabase'].includes(storageProvider) ||
    !['disabled', 'kakao'].includes(placeProvider)
  )
    throw new Error('지원하지 않는 외부 서비스 설정입니다.');
  // 시험용 발송이 운영에서 인증 성공처럼 보이지 않도록 시작 단계부터 차단합니다.
  if (
    production &&
    (emailProvider === 'local' ||
      smsProvider === 'local' ||
      !process.env.POLICY_VERSION)
  )
    throw new Error(
      '운영 환경에는 실제 발송 서비스와 확정한 POLICY_VERSION이 필요합니다.',
    );
  const requireSettings = (names: string[]) => {
    if (names.some((name) => !process.env[name]))
      throw new Error(
        '외부 서비스의 필수 설정이 없습니다: ' + names.join(', '),
      );
  };
  if (emailProvider === 'resend')
    requireSettings(['RESEND_API_KEY', 'EMAIL_FROM']);
  if (smsProvider === 'solapi')
    requireSettings(['SOLAPI_API_KEY', 'SOLAPI_API_SECRET', 'SMS_FROM']);
  if (placeProvider === 'kakao') requireSettings(['KAKAO_REST_API_KEY']);
  if (storageProvider === 'supabase') {
    requireSettings([
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_STORAGE_BUCKET',
    ]);
    if (!process.env.SUPABASE_URL?.startsWith('https://'))
      throw new Error('Supabase는 HTTPS 주소를 사용하세요.');
  }
  return {
    databaseUrl,
    production,
    trustProxyHops,
    origins,
    piiKey: secret('PII_KEY'),
    signingKey: secret('SIGNING_KEY'),
    cookieName: production ? '__Host-mishu_session' : 'mishu_session',
    storagePath: process.env.STORAGE_PATH ?? '.local/photos',
    outboxPath: process.env.OUTBOX_PATH ?? '.local/outbox',
    policyVersion: process.env.POLICY_VERSION ?? 'dev-v1',
    emailProvider,
    smsProvider,
    storageProvider,
    placeProvider,
    resendKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM,
    solapiKey: process.env.SOLAPI_API_KEY,
    solapiSecret: process.env.SOLAPI_API_SECRET,
    smsFrom: process.env.SMS_FROM,
    kakaoKey: process.env.KAKAO_REST_API_KEY,
    supabaseUrl: process.env.SUPABASE_URL?.replace(/\/$/, ''),
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseBucket: process.env.SUPABASE_STORAGE_BUCKET,
  };
}
