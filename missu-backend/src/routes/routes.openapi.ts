import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
/** 모바일 팀이 같은 입력·응답 계약으로 구현할 수 있도록 위치 API 명세를 붙입니다. */
export function completeRoutesOpenApi(doc: OpenAPIObject) {
  const str: SchemaObject = { type: 'string' },
    uuid: SchemaObject = { type: 'string', format: 'uuid' },
    time: SchemaObject = { type: 'string', format: 'date-time' };
  const obj = (
    properties: Record<string, SchemaObject>,
    required = Object.keys(properties),
  ): SchemaObject => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
  const record = obj({
    id: uuid,
    source: { type: 'string', enum: ['DEVICE', 'DEMO'] },
    startedAt: time,
    autoStopsAt: time,
    stoppedAt: { ...time, nullable: true },
  });
  const point = obj({
    clientPointId: uuid,
    recordedAt: time,
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    accuracyM: { type: 'number', minimum: 0, maximum: 5000 },
  });
  const contracts: Array<{
    method: 'get' | 'post' | 'delete';
    path: string;
    status: number;
    input?: SchemaObject;
    output: SchemaObject;
  }> = [
    {
      method: 'get',
      path: '/status',
      status: 200,
      output: obj({
        active: { ...record, nullable: true },
        policyVersion: str,
        retentionHours: { type: 'integer' },
        timeZone: str,
        maxRecordingHours: { type: 'integer' },
      }),
    },
    {
      method: 'post',
      path: '/recordings',
      status: 201,
      input: obj({
        clientRecordingId: uuid,
        agreed: { type: 'boolean', enum: [true] },
        policyVersion: { type: 'string', enum: ['route-48h-v1'] },
        source: { type: 'string', enum: ['DEVICE', 'DEMO'] },
      }),
      output: record,
    },
    {
      method: 'post',
      path: '/recordings/{id}/points',
      status: 200,
      input: obj({
        points: { type: 'array', items: point, minItems: 1, maxItems: 100 },
      }),
      output: obj({
        accepted: { type: 'integer' },
        duplicates: { type: 'integer' },
        retentionHours: { type: 'integer' },
      }),
    },
    {
      method: 'post',
      path: '/recordings/{id}/stop',
      status: 200,
      input: obj({}),
      output: record,
    },
    {
      method: 'get',
      path: '',
      status: 200,
      output: obj({
        date: str,
        timeZone: str,
        retentionHours: { type: 'integer' },
        points: {
          type: 'array',
          items: obj({
            id: uuid,
            recordingId: uuid,
            source: str,
            recordedAt: time,
            expiresAt: time,
            lat: { type: 'number' },
            lng: { type: 'number' },
            accuracyM: { type: 'number' },
          }),
        },
      }),
    },
    {
      method: 'get',
      path: '/points/{id}/nearby',
      status: 200,
      output: {
        type: 'array',
        items: {
          allOf: [
            { $ref: '#/components/schemas/MissuPublicItem' },
            {
              type: 'object',
              properties: { distanceM: { type: 'integer', minimum: 0 } },
              required: ['distanceM'],
            },
          ],
        },
      },
    },
    {
      method: 'delete',
      path: '',
      status: 200,
      output: obj({
        deletedPoints: { type: 'integer' },
        recordingStopped: { type: 'boolean' },
      }),
    },
  ];
  for (const c of contracts) {
    const operation = doc.paths['/api/v1/me/routes' + c.path]?.[c.method];
    if (!operation) throw new Error('Route contract missing');
    operation.security = [{ sessionCookie: [] }, { mobileBearer: [] }];
    operation.description =
      '본인만 사용. 관측 시각부터 48시간 보관. DEMO는 개발 서버 전용. 좌표를 로그나 영구 백업에 넣지 마세요.';
    operation.parameters = (operation.parameters ?? []).filter(
      (p) => !('in' in p) || p.in === 'path',
    );
    if (c.method !== 'get')
      operation.parameters.push({
        in: 'header',
        name: 'X-CSRF-Token',
        required: false,
        description:
          '웹 쿠키 인증에서만 필수. 모바일 Bearer 요청에는 생략합니다.',
        schema: str,
      });
    if (!c.path)
      operation.parameters.push({
        in: 'query',
        name: 'date',
        required: c.method === 'get',
        schema: { type: 'string', format: 'date' },
        description: 'Asia/Seoul 기준 YYYY-MM-DD',
      });
    if (c.method === 'delete')
      operation.parameters.push({
        in: 'query',
        name: 'all',
        required: false,
        schema: { type: 'string', enum: ['true'] },
        description:
          'date 또는 all=true 중 하나만 지정. 삭제 시 진행 중 기록도 중지.',
      });
    if (c.input)
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: c.input } },
      };
    operation.responses = {
      [c.status]: {
        description: '성공',
        content: {
          'application/json': {
            schema: obj({
              data: c.output,
              ...(c.path.endsWith('/nearby')
                ? {
                    meta: obj(
                      {
                        nextCursor: { type: 'string', nullable: true },
                        truncated: { type: 'boolean' },
                        notice: str,
                      },
                      ['nextCursor', 'truncated'],
                    ),
                  }
                : {}),
            }),
          },
        },
      },
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 429].map((status) => [
          status,
          { description: '입력·권한·중복·기록 상태 제한' },
        ]),
      ),
    };
  }
  return doc;
}
