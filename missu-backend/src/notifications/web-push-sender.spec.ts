import { createECDH, randomBytes } from 'node:crypto';
import { NotificationSender, webSubscription } from './web-push-sender';

describe('홈 화면 웹 푸시', () => {
  const ec = createECDH('prime256v1');
  ec.generateKeys();
  const subscription = {
    endpoint: 'https://web.push.apple.com/test',
    keys: {
      p256dh: ec.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
  const token = (s = subscription) =>
    'webpush:' + Buffer.from(JSON.stringify(s)).toString('base64url');
  const original = process.env.WEB_PUSH_VAPID_JSON;
  beforeEach(() => {
    process.env.WEB_PUSH_VAPID_JSON = JSON.stringify({
      publicKey: ec.getPublicKey().toString('base64url'),
      privateKey: ec.getPrivateKey().toString('base64url'),
      subject: 'https://missu-web.onrender.com',
    });
  });
  afterEach(() => {
    if (original === undefined) delete process.env.WEB_PUSH_VAPID_JSON;
    else process.env.WEB_PUSH_VAPID_JSON = original;
  });
  it('공식 브라우저 푸시 서버와 유효한 수신 암호키만 허용한다', () => {
    expect(webSubscription(token())).toEqual(subscription);
    for (const endpoint of [
      'http://web.push.apple.com/test',
      'https://127.0.0.1/',
      'https://web.push.apple.com.evil.test/',
      'https://user@web.push.apple.com/test',
    ]) {
      expect(
        webSubscription(token({ ...subscription, endpoint })),
      ).toBeUndefined();
    }
    expect(
      webSubscription(
        token({
          ...subscription,
          keys: { ...subscription.keys, p256dh: 'A'.repeat(87) },
        }),
      ),
    ).toBeUndefined();
  });
  it('로그인 결합값과 알림 ID만 암호화 전송하고 개인정보는 담지 않는다', async () => {
    const send = jest.fn().mockResolvedValue({ statusCode: 201 });
    expect(
      await new NotificationSender(send).send(token(), 'binding', 'id'),
    ).toBe('sent');
    expect(JSON.parse(send.mock.calls[0][1])).toEqual({
      binding: 'binding',
      notificationId: 'id',
    });
    expect(send.mock.calls[0][2]).toMatchObject({
      TTL: 3600,
      timeout: 10000,
      topic: 'missu-matches',
    });
  });
  it('취소된 구독은 제거하고 일시 장애는 재시도한다', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce({ statusCode: 410 })
      .mockRejectedValueOnce({ statusCode: 503 });
    const sender = new NotificationSender(send);
    expect(await sender.send(token(), 'b', 'n')).toBe('invalid');
    expect(await sender.send(token(), 'b', 'n')).toBe('retry');
    delete process.env.WEB_PUSH_VAPID_JSON;
    expect(await sender.send(token(), 'b', 'n')).toBe('unconfigured');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
