import { generateKeyPairSync, verify } from 'node:crypto';
import { FirebaseSender } from './firebase-sender';

describe('FCM 발송 계약', () => {
  const original = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  beforeEach(() => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: 'test-notifications',
      client_email: 'test@test-notifications.iam.gserviceaccount.com',
      private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (original === undefined)
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = original;
  });
  it('서명된 단기 인증으로 고정된 FCM 주소에 연결하고 분실 위치·이름은 보내지 않는다', async () => {
    const mock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'test-access', expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const sender = new FirebaseSender();
    expect(
      await sender.send('device-token', 'account-binding', 'notice-id'),
    ).toBe('sent');
    expect(
      await sender.send('device-token', 'account-binding', 'notice-id-2'),
    ).toBe('sent');
    expect(mock).toHaveBeenCalledTimes(3);
    const form = mock.mock.calls[0][1]?.body as URLSearchParams;
    const [head, payload, signature] = form.get('assertion')!.split('.');
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(head + '.' + payload),
        keys.publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).scope).toBe(
      'https://www.googleapis.com/auth/firebase.messaging',
    );
    expect(mock.mock.calls[1][0]).toBe(
      'https://fcm.googleapis.com/v1/projects/test-notifications/messages:send',
    );
    const body = JSON.parse(mock.mock.calls[1][1]!.body as string);
    expect(body.message.data).toEqual({
      binding: 'account-binding',
      notificationId: 'notice-id',
    });
    expect(body.message.android.restricted_package_name).toBe('kr.missu.web');
  });
  it('삭제된 기기 토큰과 일시적 발송 실패를 구별한다', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'test-access', expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { details: [{ errorCode: 'UNREGISTERED' }] },
          }),
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const sender = new FirebaseSender();
    expect(await sender.send('device', 'binding', 'notice')).toBe('invalid');
    expect(await sender.send('device', 'binding', 'notice')).toBe('retry');
  });
  it('설정이 없으면 발송 완료로 처리하지 않는다', async () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const mock = jest.spyOn(globalThis, 'fetch');
    expect(await new FirebaseSender().send('device', 'binding', 'notice')).toBe(
      'unconfigured',
    );
    expect(mock).not.toHaveBeenCalled();
  });
});
