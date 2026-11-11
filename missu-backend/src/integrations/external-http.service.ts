/** 외부 호출의 시간 제한과 오류를 한곳에서 처리하고 비밀 키·발송 본문은 로그에 남기지 않습니다. */
import { Injectable } from '@nestjs/common';
import { fail } from '../common/http';

@Injectable()
export class ExternalHttpService {
  async request(url: string, init: RequestInit = {}) {
    try {
      const response = await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Provider rejected request');
      return response;
    } catch {
      fail(503, 'EXTERNAL_UNAVAILABLE', '외부 서비스에 연결하지 못했습니다.');
    }
  }
}
