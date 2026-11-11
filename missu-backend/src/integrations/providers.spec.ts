/** 외부 사업자에게 실제 발송하지 않고 공식 요청/응답 계약과 실패 처리를 검사합니다. */
import { createHmac, randomUUID } from 'node:crypto';
import { ExternalHttpService } from './external-http.service';
import { DeliveryService } from './delivery.service';
import { StorageService } from './storage.service';
import { config } from '../config';

describe('외부 서비스 어댑터', () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:54330/missu_test',
      PII_KEY: '1'.repeat(64),
      SIGNING_KEY: '2'.repeat(64),
      NODE_ENV: 'test',
      EMAIL_PROVIDER: 'local',
      SMS_PROVIDER: 'local',
      STORAGE_PROVIDER: 'local',
      PLACE_PROVIDER: 'disabled',
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  it('Resend 요청에 멱등 키를 넣고 응답 실패를 감춘 성공으로 처리하지 않는다', async () => {
    Object.assign(process.env, {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'test-resend',
      EMAIL_FROM: 'test@missu.test',
    });
    const http = new ExternalHttpService(),
      call = jest
        .spyOn(http, 'request')
        .mockResolvedValue(new Response(JSON.stringify({ id: 'provider-id' })));
    const service = new DeliveryService(http),
      id = randomUUID();
    await service.send(
      id,
      'SIGNUP',
      'receiver@missu.test',
      '123456',
      new Date(),
    );
    expect(call.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(call.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer test-resend',
      'Idempotency-Key': 'challenge/' + id,
    });
    expect(JSON.parse(call.mock.calls[0][1]!.body as string).to).toEqual([
      'receiver@missu.test',
    ]);
    call.mockResolvedValue(new Response('invalid json'));
    await expect(
      service.send(id, 'SIGNUP', 'receiver@missu.test', '123456', new Date()),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('SOLAPI 서명을 만들고 HTTP 200 안의 발송 거절도 검사한다', async () => {
    Object.assign(process.env, {
      SMS_PROVIDER: 'solapi',
      SOLAPI_API_KEY: 'test-key',
      SOLAPI_API_SECRET: 'test-secret',
      SMS_FROM: '01011112222',
    });
    const http = new ExternalHttpService(),
      call = jest.spyOn(http, 'request').mockResolvedValue(
        new Response(
          JSON.stringify({
            groupInfo: { count: { registeredSuccess: 1 } },
            failedMessageList: [],
          }),
        ),
      );
    const service = new DeliveryService(http);
    await service.send(
      randomUUID(),
      'PHONE',
      '01012345678',
      '123456',
      new Date(),
    );
    const auth = (call.mock.calls[0][1]!.headers as Record<string, string>)
      .Authorization;
    const parsed = /date=([^,]+), salt=([^,]+), signature=(.+)$/.exec(auth)!;
    expect(parsed[3]).toBe(
      createHmac('sha256', 'test-secret')
        .update(parsed[1] + parsed[2])
        .digest('hex'),
    );
    const message = JSON.parse(call.mock.calls[0][1]!.body as string)
      .messages[0];
    expect(message.to).toBe('01012345678');
    expect(message.from).toBe('01011112222');
    expect(Buffer.byteLength(message.text, 'utf8')).toBeLessThanOrEqual(90);
    call.mockResolvedValue(
      new Response(
        JSON.stringify({
          groupInfo: { count: { registeredSuccess: 0 } },
          failedMessageList: [{ statusCode: '3040' }],
        }),
      ),
    );
    await expect(
      service.send(randomUUID(), 'PHONE', '01012345678', '123456', new Date()),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('Supabase 비공개 버킷을 확인하고 사진 저장·읽기·삭제 계약을 사용한다', async () => {
    Object.assign(process.env, {
      STORAGE_PROVIDER: 'supabase',
      SUPABASE_URL: 'https://fixture.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-role',
      SUPABASE_STORAGE_BUCKET: 'photos',
    });
    const http = new ExternalHttpService(),
      call = jest
        .spyOn(http, 'request')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'photos', public: false })),
        )
        .mockResolvedValueOnce(new Response('{}'))
        .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
        .mockResolvedValueOnce(new Response('[]'));
    const service = new StorageService(http),
      key = randomUUID() + '.webp';
    await service.onModuleInit();
    await service.put(key, Buffer.from([1, 2, 3]));
    expect(await service.get(key)).toEqual(Buffer.from([1, 2, 3]));
    await service.remove(key);
    expect(call.mock.calls[0][0]).toBe(
      'https://fixture.supabase.co/storage/v1/bucket/photos',
    );
    expect(call.mock.calls[1][1]?.method).toBe('POST');
    expect(call.mock.calls[3][1]?.method).toBe('DELETE');
    expect(JSON.parse(call.mock.calls[3][1]!.body as string)).toEqual({
      prefixes: [key],
    });
    expect(call.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: 'Bearer test-role',
      apikey: 'test-role',
    });
  });
  it('공개 버킷과 운영 환경의 로컬 인증 대역을 거절한다', async () => {
    Object.assign(process.env, {
      STORAGE_PROVIDER: 'supabase',
      SUPABASE_URL: 'https://fixture.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-role',
      SUPABASE_STORAGE_BUCKET: 'photos',
    });
    const http = new ExternalHttpService();
    jest
      .spyOn(http, 'request')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'photos', public: true })),
      );
    await expect(new StorageService(http).onModuleInit()).rejects.toThrow(
      '비공개',
    );
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'https://missu.test';
    expect(() => config()).toThrow('실제 발송');
  });
  it('외부 연결 오류의 원문·비밀 정보를 응답에 포함하지 않는다', async () => {
    const call = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('secret-provider-token'));
    try {
      await new ExternalHttpService().request('https://fixture.invalid');
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toMatchObject({ status: 503 });
      expect(JSON.stringify(error)).not.toContain('secret-provider-token');
    }
    expect(call.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    expect(call.mock.calls[0][1]?.signal).toBeDefined();
  });
});
