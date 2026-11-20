import { ECDH } from 'node:crypto';
import * as webpush from 'web-push';
import { FirebaseSender, type PushResult } from './firebase-sender';

const prefix = 'webpush:';
export function webSubscription(
  token: string,
): webpush.PushSubscription | undefined {
  try {
    if (!token.startsWith(prefix) || token.length > 4096) return;
    const s = JSON.parse(
      Buffer.from(token.slice(prefix.length), 'base64url').toString(),
    ) as webpush.PushSubscription;
    const url = new URL(s.endpoint);
    // 사용자가 임의의 내부 서버 주소로 발송하게 할 수 없도록 공식 푸시 서버만 허용합니다.
    const allowed =
      url.hostname === 'web.push.apple.com' ||
      /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname) ||
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com';
    if (
      !allowed ||
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      s.endpoint.length > 2048
    )
      return;
    if (
      !/^[A-Za-z0-9_-]{87}={0,2}$/.test(s.keys.p256dh) ||
      !/^[A-Za-z0-9_-]{22}={0,2}$/.test(s.keys.auth)
    )
      return;
    const key = Buffer.from(s.keys.p256dh, 'base64url');
    if (
      key.length !== 65 ||
      Buffer.from(s.keys.auth, 'base64url').length !== 16
    )
      return;
    ECDH.convertKey(key, 'prime256v1');
    return {
      endpoint: url.href,
      keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
    };
  } catch {
    return;
  }
}

/** Android FCM과 홈 화면 웹 푸시가 같은 알림 대기열을 사용합니다. */
export class NotificationSender extends FirebaseSender {
  constructor(private readonly deliver = webpush.sendNotification) {
    super();
  }
  private webConfig() {
    try {
      const raw = process.env.WEB_PUSH_VAPID_JSON;
      if (!raw) return;
      const c = JSON.parse(raw) as {
        publicKey: string;
        privateKey: string;
        subject: string;
      };
      if (
        !/^[A-Za-z0-9_-]{87}$/.test(c.publicKey) ||
        !/^[A-Za-z0-9_-]{43}$/.test(c.privateKey) ||
        c.subject !== 'https://missu-web.onrender.com'
      )
        return;
      return c;
    } catch {
      return;
    }
  }
  publicKey() {
    return this.webConfig()?.publicKey;
  }
  override configured(token?: string) {
    if (token?.startsWith(prefix)) return !!this.webConfig();
    return token
      ? super.configured()
      : !!this.webConfig() || super.configured();
  }
  override async send(
    token: string,
    binding: string,
    notificationId: string,
  ): Promise<PushResult> {
    if (!token.startsWith(prefix))
      return super.send(token, binding, notificationId);
    const subscription = webSubscription(token);
    if (!subscription) return 'invalid';
    const config = this.webConfig();
    if (!config) return 'unconfigured';
    try {
      await this.deliver(
        subscription,
        JSON.stringify({ binding, notificationId }),
        {
          vapidDetails: config,
          TTL: 3600,
          urgency: 'normal',
          topic: 'missu-matches',
          timeout: 10000,
        },
      );
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      return status === 404 || status === 410 ? 'invalid' : 'retry';
    }
  }
}
