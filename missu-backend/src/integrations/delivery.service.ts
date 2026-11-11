/** 개발 모드 인증번호는 로컬 파일에만 저장합니다. 운영 모드는 Resend/SOLAPI 없이는 발송하지 않습니다. */
import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../config';
import { fail } from '../common/http';
import { ExternalHttpService } from './external-http.service';

@Injectable()
export class DeliveryService {
  constructor(private readonly http: ExternalHttpService) {}
  async send(
    id: string,
    purpose: string,
    target: string,
    code: string,
    expiresAt: Date,
  ) {
    const settings = config();
    const provider =
      purpose === 'PHONE' ? settings.smsProvider : settings.emailProvider;
    if (provider === 'local') {
      if (settings.production)
        fail(503, 'DELIVERY_NOT_CONFIGURED', '발송 설정이 필요합니다.');
      await mkdir(settings.outboxPath, { recursive: true });
      await writeFile(
        resolve(settings.outboxPath, id + '.json'),
        JSON.stringify({
          challengeId: id,
          purpose,
          target,
          code,
          expiresAt,
          mode: 'LOCAL_ONLY',
        }),
        { flag: 'wx', mode: 0o600 },
      );
      return;
    }
    const text = '[미슈] 인증번호 ' + code + ' (본인 요청 시에만 입력)';
    if (purpose !== 'PHONE' && provider === 'resend') {
      const response = await this.http.request(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + settings.resendKey,
            'Content-Type': 'application/json',
            'Idempotency-Key': 'challenge/' + id,
          },
          body: JSON.stringify({
            from: settings.emailFrom,
            to: [target],
            subject: '미슈 이메일 인증',
            text,
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        id?: string;
      } | null;
      if (!body?.id)
        fail(503, 'EXTERNAL_UNAVAILABLE', '이메일 발송 접수에 실패했습니다.');
      return;
    }
    if (purpose === 'PHONE' && provider === 'solapi') {
      const date = new Date().toISOString(),
        salt = randomBytes(24).toString('hex');
      const signature = createHmac('sha256', settings.solapiSecret!)
        .update(date + salt)
        .digest('hex');
      const response = await this.http.request(
        'https://api.solapi.com/messages/v4/send-many/detail',
        {
          method: 'POST',
          headers: {
            Authorization:
              'HMAC-SHA256 apiKey=' +
              settings.solapiKey +
              ', date=' +
              date +
              ', salt=' +
              salt +
              ', signature=' +
              signature,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [
              { to: target, from: settings.smsFrom, text, type: 'SMS' },
            ],
          }),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        failedMessageList?: unknown[];
        groupInfo?: { count?: { registeredSuccess?: number } };
      } | null;
      if (
        !body ||
        body.failedMessageList?.length ||
        body.groupInfo?.count?.registeredSuccess !== 1
      )
        fail(503, 'EXTERNAL_UNAVAILABLE', '문자 발송 접수에 실패했습니다.');
      return;
    }
    fail(503, 'DELIVERY_NOT_CONFIGURED', '발송 설정이 필요합니다.');
  }
}
