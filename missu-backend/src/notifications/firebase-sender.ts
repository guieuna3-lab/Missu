import { createSign } from 'node:crypto';

type Credentials = {
  project_id: string;
  client_email: string;
  private_key: string;
};
export type PushResult = 'sent' | 'invalid' | 'retry' | 'unconfigured';

/** 서버 전용 키로 짧은 수명의 발송 토큰을 발급합니다. 키·수신 토큰은 로그에 남기지 않습니다. */
export class FirebaseSender {
  private access?: { token: string; expires: number };
  private pending?: Promise<string>;
  private credentials() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) return;
    const c = JSON.parse(raw) as Credentials;
    if (
      !/^[a-z][a-z0-9-]{4,60}$/.test(c.project_id) ||
      !c.client_email?.endsWith('.iam.gserviceaccount.com') ||
      !c.private_key?.includes('PRIVATE KEY')
    )
      throw Error('Invalid Firebase configuration');
    return c;
  }
  configured() {
    try {
      return !!this.credentials();
    } catch {
      return false;
    }
  }
  private async accessToken(c: Credentials) {
    if (this.access && this.access.expires > Date.now())
      return this.access.token;
    if (this.pending) return this.pending;
    const pending = this.issue(c);
    this.pending = pending;
    try {
      return await pending;
    } finally {
      this.pending = undefined;
    }
  }
  private async issue(c: Credentials) {
    const enc = (v: object) =>
      Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned =
      enc({ alg: 'RS256', typ: 'JWT' }) +
      '.' +
      enc({
        iss: c.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      });
    const assertion =
      unsigned +
      '.' +
      createSign('RSA-SHA256')
        .update(unsigned)
        .sign(c.private_key, 'base64url');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error('Firebase authentication failed');
    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    if (!data.access_token || !Number.isFinite(data.expires_in))
      throw Error('Invalid Firebase response');
    this.access = {
      token: data.access_token,
      expires: Date.now() + Math.max(0, data.expires_in - 60) * 1000,
    };
    return data.access_token;
  }
  async send(
    token: string,
    binding: string,
    notificationId: string,
  ): Promise<PushResult> {
    try {
      const c = this.credentials();
      if (!c) return 'unconfigured';
      const access = await this.accessToken(c);
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              data: { binding, notificationId },
              android: {
                priority: 'high',
                ttl: '3600s',
                collapse_key: 'missu-matches',
                restricted_package_name: 'kr.missu.web',
              },
            },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (response.ok) return 'sent';
      if (response.status === 401) this.access = undefined;
      const data = (await response.json()) as {
        error?: { details?: { errorCode?: string }[] };
      };
      return data.error?.details?.some((d) => d.errorCode === 'UNREGISTERED')
        ? 'invalid'
        : 'retry';
    } catch {
      return 'retry';
    }
  }
}
