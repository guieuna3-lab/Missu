/** 실제 응답의 공개 필드·상태·필수 헤더를 API 문서에도 명시해 프런트엔드 연결 기준으로 사용합니다. */
import type {
  OpenAPIObject,
  SchemaObject,
  ReferenceObject,
} from '@nestjs/swagger';
import { completeRoutesOpenApi } from './routes/routes.openapi';
type Schema = SchemaObject | ReferenceObject;
const string: SchemaObject = { type: 'string' };
const nullable: SchemaObject = { type: 'string', nullable: true };
const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const date: SchemaObject = { type: 'string', format: 'date-time' };
const bool: SchemaObject = { type: 'boolean' };
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): SchemaObject => ({ type: 'object', properties, required });
const ref = (name: string): ReferenceObject => ({
  $ref: '#/components/schemas/Missu' + name,
});
const array = (items: Schema): SchemaObject => ({ type: 'array', items });
const states: SchemaObject = {
  type: 'string',
  enum: [
    'PENDING',
    'REJECTED',
    'APPROVED',
    'HANDED_OVER',
    'RETURNED',
    'CLOSED',
  ],
};
const itemStates: SchemaObject = {
  type: 'string',
  enum: ['AVAILABLE', 'RESERVED', 'RETURNED'],
};
const cursorMeta = object({ nextCursor: nullable });
const receipt = object({
  reportId: uuid,
  status: { type: 'string', enum: ['RECEIVED'] },
  receivedAt: date,
});
const transition = object({
  claimId: uuid,
  status: states,
  itemStatus: itemStates,
  updatedAt: date,
});

export function completeOpenApi(document: OpenAPIObject) {
  const schemas: Record<string, SchemaObject> = {
    Location: object({
      label: string,
      lat: { type: 'number' },
      lng: { type: 'number' },
    }),
    LostTime: object({
      start: date,
      end: date,
      precision: { type: 'string', enum: ['EXACT', 'APPROX', 'DATE'] },
    }),
    Profile: object({
      id: uuid,
      email: { type: 'string', format: 'email' },
      nickname: string,
      phoneVerified: bool,
    }),
    PublicItem: object({
      id: uuid,
      name: string,
      category: {
        type: 'string',
        enum: ['OTHER', 'ELECTRONICS', 'WALLET_BAG'],
      },
      publicFeatures: nullable,
      foundAt: date,
      foundLocation: ref('Location'),
      photos: array(object({ id: uuid, url: string })),
      storagePlace: string,
      pickupGuide: nullable,
      status: itemStates,
      createdAt: date,
    }),
    LostReport: object({
      id: uuid,
      placeName: string,
      category: string,
      name: string,
      features: nullable,
      lostTime: ref('LostTime'),
      lostLocation: ref('Location'),
      createdAt: date,
    }),
    Appointment: object({
      id: uuid,
      by: { type: 'string', enum: ['holder', 'requester'] },
      confirmed: bool,
      place: string,
      date: string,
      time: string,
    }),
    Claim: object({
      id: uuid,
      itemId: uuid,
      requesterNickname: string,
      itemName: string,
      storageName: string,
      viewerRole: { type: 'string', enum: ['holder', 'requester'] },
      createdAt: date,
      features: string,
      lostInfo: nullable,
      lostTime: {
        ...object({ start: date, end: date, precision: string }),
        nullable: true,
      },
      lostLocation: {
        ...object({
          label: string,
          lat: { type: 'number' },
          lng: { type: 'number' },
        }),
        nullable: true,
      },
      appointment: {
        type: 'object',
        nullable: true,
        properties: {
          id: uuid,
          by: string,
          confirmed: bool,
          place: string,
          date: string,
          time: string,
        },
      },
      status: states,
      decisionReason: nullable,
      approvedAt: { ...date, nullable: true },
      handedOverAt: { ...date, nullable: true },
      receivedAt: { ...date, nullable: true },
      updatedAt: date,
    }),
    Message: object({ id: uuid, senderId: uuid, body: string, sentAt: date }),
    History: object(
      {
        id: uuid,
        itemId: uuid,
        name: string,
        status: string,
        createdAt: date,
        updatedAt: date,
      },
      ['id', 'name', 'createdAt', 'updatedAt'],
    ),
    Error: object({
      error: object(
        {
          code: string,
          message: { oneOf: [string, array(string)] },
          requestId: uuid,
          fields: { type: 'object', additionalProperties: array(string) },
        },
        ['code', 'message', 'requestId'],
      ),
    }),
  };
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.securitySchemes ??= {};
  document.components.securitySchemes.mobileBearer = {
    type: 'http',
    scheme: 'bearer',
    description: '모바일 로그인 또는 가입용 익명 세션에서 받은 토큰',
  };
  for (const [name, schema] of Object.entries(schemas))
    document.components.schemas['Missu' + name] = schema;
  const envelope = (data: Schema, meta?: Schema) =>
    object({ data, ...(meta ? { meta } : {}) });
  // 28개 업무 API의 실제 계약입니다. 건강 확인과 사진 읽기는 별도 보조 API입니다.
  const contracts: Record<string, [number, Schema | null]> = {
    'get /api/v1/auth/csrf': [200, envelope(object({ csrfToken: string }))],
    'post /api/v1/auth/challenges': [
      202,
      envelope(
        object({
          challengeId: uuid,
          retryAfter: { type: 'integer' },
          expiresAt: date,
        }),
      ),
    ],
    'post /api/v1/auth/challenges/{id}/verify': [
      200,
      envelope(object({ verified: bool, proof: string }, ['verified'])),
    ],
    'post /api/v1/auth/signup': [201, envelope(object({ id: uuid }))],
    'post /api/v1/auth/login': [
      200,
      envelope(object({ user: ref('Profile'), csrfToken: string })),
    ],
    'post /api/v1/auth/mobile/login': [
      200,
      envelope(
        object({ user: ref('Profile'), accessToken: string, expiresAt: date }),
      ),
    ],
    'post /api/v1/auth/mobile/session': [
      201,
      envelope(object({ accessToken: string, expiresAt: date })),
    ],
    'post /api/v1/auth/logout': [204, null],
    'post /api/v1/auth/password-reset': [204, null],
    'patch /api/v1/me/password': [204, null],
    'delete /api/v1/me/phone': [204, null],
    'delete /api/v1/me': [204, null],
    'get /api/v1/me': [200, envelope(ref('Profile'))],
    'patch /api/v1/me': [200, envelope(ref('Profile'))],
    'get /api/v1/items': [200, envelope(array(ref('PublicItem')), cursorMeta)],
    'get /api/v1/items/{id}': [200, envelope(ref('PublicItem'))],
    'get /api/v1/items/nearby': [
      200,
      envelope(
        array({
          allOf: [
            ref('PublicItem'),
            object({ distanceM: { type: 'integer' } }),
          ],
        }),
        object({ nextCursor: nullable, truncated: bool, notice: string }, [
          'nextCursor',
          'truncated',
        ]),
      ),
    ],
    'post /api/v1/places/reverse': [
      200,
      envelope(object({ address: nullable })),
    ],
    'get /api/v1/places': [
      200,
      envelope(
        array(
          object({
            providerPlaceId: string,
            name: string,
            address: string,
            lat: { type: 'number' },
            lng: { type: 'number' },
          }),
        ),
      ),
    ],
    'post /api/v1/uploads': [
      201,
      envelope(
        object({ photoId: uuid, state: { type: 'string', enum: ['READY'] } }),
      ),
    ],
    'post /api/v1/items': [
      201,
      envelope(
        object({ id: uuid, status: { type: 'string', enum: ['AVAILABLE'] } }),
      ),
    ],
    'get /api/v1/lost-reports': [
      200,
      envelope(array(ref('LostReport')), cursorMeta),
    ],
    'put /api/v1/lost-reports/{id}': [200, envelope(ref('LostReport'))],
    'delete /api/v1/lost-reports/{id}': [204, null],
    'put /api/v1/items/{id}': [
      200,
      envelope({
        allOf: [
          ref('PublicItem'),
          object({ privateFeatures: nullable, appCategory: nullable }),
        ],
      }),
    ],
    'post /api/v1/lost-reports': [201, envelope(object({ id: uuid }))],
    'get /api/v1/lost-reports/{id}': [200, envelope(ref('LostReport'))],
    'get /api/v1/items/{id}/manage': [
      200,
      envelope({
        allOf: [ref('PublicItem'), object({ privateFeatures: nullable })],
      }),
    ],
    'post /api/v1/items/{id}/claims': [
      201,
      envelope(
        object({
          claimId: uuid,
          status: { type: 'string', enum: ['PENDING'] },
        }),
      ),
    ],
    'get /api/v1/claims/{id}': [200, envelope(ref('Claim'))],
    'get /api/v1/me/claims': [200, envelope(array(ref('Claim')), cursorMeta)],
    'post /api/v1/claims/{id}/appointment': [200, envelope(ref('Appointment'))],
    'post /api/v1/claims/{id}/appointment/confirm': [
      200,
      envelope(ref('Appointment')),
    ],
    'post /api/v1/claims/{id}/cancel': [
      200,
      envelope(object({ claimId: uuid, status: states })),
    ],
    'post /api/v1/claims/{id}/decision': [
      200,
      envelope(
        object({ claimId: uuid, status: states, itemStatus: itemStates }),
      ),
    ],
    'get /api/v1/claims/{id}/messages': [
      200,
      envelope(
        object({
          messages: array(ref('Message')),
          nextCursor: nullable,
          previousCursor: nullable,
          hasMore: bool,
        }),
      ),
    ],
    'post /api/v1/claims/{id}/messages': [201, envelope(ref('Message'))],
    'post /api/v1/claims/{id}/handover': [200, envelope(transition)],
    'post /api/v1/claims/{id}/receipt': [200, envelope(transition)],
    'get /api/v1/me/history': [
      200,
      envelope(array(ref('History')), cursorMeta),
    ],
    'post /api/v1/claims/{id}/reports': [201, envelope(receipt)],
    'get /api/v1/reports/{id}': [
      200,
      envelope({
        ...receipt,
        properties: {
          ...receipt.properties,
          reason: string,
          description: nullable,
          photoCount: { type: 'integer' },
        },
        required: [...receipt.required!, 'reason'],
      }),
    ],
  };
  const anonymousGet = new Set([
    '/api/v1/auth/csrf',
    '/api/v1/items',
    '/api/v1/items/{id}',
    '/api/v1/items/nearby',
    '/api/v1/places',
  ]);
  for (const [key, [status, body]] of Object.entries(contracts)) {
    const [method, path] = key.split(' ');
    const operation =
      document.paths[path]?.[
        method as 'get' | 'post' | 'patch' | 'put' | 'delete'
      ];
    if (!operation) throw new Error('API contract missing route: ' + key);
    const mobileEntry = path.startsWith('/api/v1/auth/mobile/');
    const webLogin = path === '/api/v1/auth/login';
    operation.security =
      mobileEntry || (method === 'get' && anonymousGet.has(path))
        ? []
        : webLogin
          ? [{ sessionCookie: [] }]
          : [{ sessionCookie: [] }, { mobileBearer: [] }];
    operation.parameters ??= [];
    if (method !== 'get' && !mobileEntry)
      operation.parameters.push({
        in: 'header',
        name: 'X-CSRF-Token',
        required: webLogin,
        schema: string,
        description:
          '웹 쿠키 인증에서만 필수. /auth/csrf 또는 웹 로그인 응답의 최신 토큰',
      });
    if (
      method === 'post' &&
      (/^\/api\/v1\/(items|lost-reports)$/.test(path) ||
        /^\/api\/v1\/items\/\{id\}\/claims$/.test(path) ||
        /^\/api\/v1\/claims\/\{id\}\/(decision|handover|receipt|reports|cancel|appointment(?:\/confirm)?)$/.test(
          path,
        ))
    )
      operation.parameters.push({
        in: 'header',
        name: 'Idempotency-Key',
        required: true,
        schema: uuid,
        description: '같은 작업의 재시도에는 같은 UUID 사용',
      });
    operation.parameters = operation.parameters.filter(
      (parameter, index, all) =>
        !('name' in parameter) ||
        all.findIndex(
          (other) =>
            'name' in other &&
            other.in === parameter.in &&
            other.name === parameter.name,
        ) === index,
    );
    for (const parameter of operation.parameters) {
      if ('name' in parameter && parameter.name === 'X-CSRF-Token') {
        parameter.required = webLogin;
        parameter.description =
          '웹 쿠키 인증에서만 필수. 모바일 Bearer 요청에는 생략합니다.';
      }
    }
    operation.responses = {
      [status]: {
        description: status === 204 ? '성공, 응답 본문 없음' : '성공',
        ...(body ? { content: { 'application/json': { schema: body } } } : {}),
      },
      ...Object.fromEntries(
        [400, 401, 403, 404, 409, 429, 503].map((code) => [
          code,
          {
            description: '입력·권한·상태 또는 외부 서비스 오류',
            content: { 'application/json': { schema: ref('Error') } },
          },
        ]),
      ),
    };
  }
  return completeRoutesOpenApi(document);
}
