# 미슈 MVP API 계약

개발 기본 주소: http://localhost:3000/api/v1

## React Native 앱 로그인

아래 경로는 기본 주소의 `/api/v1` 다음에 붙입니다. 운영 환경에서는 배포 후 발급된 HTTPS 주소를 사용합니다.

1. `POST /auth/mobile/login`에 이메일과 비밀번호를 JSON으로 보냅니다. 성공하면 HTTP 200과 `data.user`, `data.accessToken`, `data.expiresAt`(절대 만료 시각)을 받습니다.
2. 토큰은 기기 보안 저장소에 보관하고 `Authorization: Bearer <accessToken>`으로 보냅니다. 예를 들어 `GET /me`로 현재 계정을 조회합니다. 모바일 토큰 요청은 쿠키·Origin·X-CSRF-Token을 생략합니다. 개별 API가 요구하는 Idempotency-Key는 함께 보냅니다.
3. 회원 토큰은 발급 후 최대 7일, 마지막 사용 후 30분까지 유효합니다. 만료 시(401) 다시 로그인합니다. `POST /auth/logout`이 204를 반환하면 서버에서 토큰이 폐기된 것이므로 앱에서도 지웁니다.
4. 가입·비밀번호 재설정은 먼저 `POST /auth/mobile/session`에서 임시 토큰(201, `data.accessToken`, `data.expiresAt`, 30분 유효)을 받습니다. 인증번호 요청·확인과 최종 가입 또는 재설정까지 같은 토큰을 사용합니다. 가입 후 그 토큰으로 모바일 로그인하면 회원 토큰으로 교체됩니다. 개인 정보 조회에는 회원 토큰이 필요합니다.

성공은 {data, meta?}, 오류는 {error:{code,message,requestId,fields?}}입니다.
204 응답은 본문이 없습니다. 입력·출력 스키마 전체는 openapi.json과 실행 중인 /docs에 있습니다.

## 업무 API 28개

| ID | 메서드·경로 | 접근·용도 |
|---|---|---|
| A01 | GET /auth/csrf | 사전 세션 쿠키와 CSRF 토큰 |
| A02 | POST /auth/challenges | SIGNUP·RESET·PHONE 인증번호 발급, PHONE은 회원 |
| A03 | POST /auth/challenges/{id}/verify | 같은 세션에서 인증번호 확인 |
| A04 | POST /auth/signup | 이메일 인증 증명과 필수 동의로 가입 |
| A05 | POST /auth/login | 비밀번호 확인·세션 교체 |
| A06 | POST /auth/logout | 세션 만료, 204 |
| A07 | POST /auth/password-reset | RESET 증명 소비·비밀번호 변경·세션 무효, 204 |
| A08 | GET /me | 본인 프로필 |
| A09 | PATCH /me | 닉네임 2~10자 수정 |
| A10 | GET /items | 공개 조건 검색 |
| A11 | GET /items/{id} | 공개 상세 |
| A12 | GET /items/nearby | 공개 반경 검색 |
| A13 | GET /places | Kakao 장소 검색, 미설정 시 503 |
| A14 | POST /uploads | 회원 사진 업로드 |
| A15 | POST /items | 회원 습득물 등록 |
| A16 | POST /lost-reports | 회원 분실 신고 |
| A17 | GET /lost-reports/{id} | 신고자 상세 |
| A18 | GET /items/{id}/manage | 보관자 관리 상세 |
| A19 | POST /items/{id}/claims | 전화 인증 회원의 주인 확인 요청 |
| A20 | GET /claims/{id} | 요청자·보관자의 요청 상세 |
| A21 | POST /claims/{id}/decision | 보관자 승인·거절 |
| A22 | GET /claims/{id}/messages | 승인된 양측 대화 조회 |
| A23 | POST /claims/{id}/messages | 승인·전달 상태의 양측 대화 전송 |
| A24 | POST /claims/{id}/handover | 보관자 전달 표시 |
| A25 | POST /claims/{id}/receipt | 요청자 수령 확인 |
| A26 | GET /me/history | 본인 내역 4종 |
| A27 | POST /claims/{id}/reports | 보관자의 의심 요청 신고 |
| A28 | GET /reports/{id} | 신고자 접수 결과 |

보조 API: GET /photos/{id}는 서명 URL로 사진을 읽습니다. /health/live, /health/ready, /는 /api/v1 밖에 있습니다.
전체 공개 문서는 32개 HTTP 동작을 포함합니다.

## 프런트엔드 공통 연결

1. GET /auth/csrf로 세션 쿠키와 data.csrfToken을 받습니다.
2. 브라우저 fetch는 credentials: 'include'로 쿠키를 주고받습니다. Origin은 브라우저가 보내며 백엔드 허용 주소와 일치해야 합니다.
3. 모든 POST·PATCH 요청에 X-CSRF-Token을 넣습니다. 로그인 후에는 응답의 새 토큰을 사용합니다.
4. A15·A16·A19·A21·A24·A25·A27은 Idempotency-Key(UUID)가 필수입니다. 같은 작업의 재시도에는 같은 키를 재사용합니다.
5. 메시지는 clientMessageId(UUID)로 중복을 방지합니다. 같은 키의 다른 본문은 409입니다.
6. 사용자 ID를 본문에 넣어 인증하지 않습니다. 본인 여부는 서버 세션으로 결정합니다.

로컬 허용 프런트엔드 주소는 기본 http://localhost:5173입니다. 다른 주소는 .env의 ALLOWED_ORIGINS에 명시해야 합니다.
401은 재로그인, 403 PHONE_VERIFICATION_REQUIRED는 전화 인증, 409는 최신 상태 재조회가 필요합니다.
서비스 미설정·발송 실패는 503으로 실패하며 성공한 것으로 처리하지 않습니다.

## 가입·인증

인증번호 요청:

~~~json
{"purpose":"SIGNUP","target":"developer@example.test"}
~~~

202 응답: challengeId, retryAfter(초), expiresAt. 인증번호 원문은 응답하지 않습니다.
EMAIL_PROVIDER=local이면 .local/outbox/{challengeId}.json에서만 개발용 코드를 확인합니다.
이메일 코드는 10분, PHONE 코드는 3분이며 오입력은 최대 5회입니다.
문자는 같은 계정 또는 번호로 첫 발송을 포함해 연속 3회 요청할 수 있습니다. 세 번째 요청 후 60초 동안 기다리며, 거절된 요청은 대기를 연장하지 않습니다. 60초 동안 새 요청이 없으면 횟수가 초기화됩니다. 같은 IP에서는 여러 계정을 합해 분당 5회까지 요청할 수 있습니다. 문자 응답의 `retryAfter`가 0이면 즉시 재요청할 수 있습니다.
이메일은 재발송 대기 60초와 대상·세션·IP별 시간당 5회 제한을 적용합니다.

POST /auth/challenges/{challengeId}/verify:

~~~json
{"code":"파일에서 확인한 6자리 숫자"}
~~~

SIGNUP·RESET 확인 응답에는 1회용 proof가 있습니다. 같은 세션에서 다음 단계에 사용합니다.

POST /auth/signup:

~~~json
{
  "email":"developer@example.test",
  "nickname":"미슈회원",
  "password":"12~128자, 영문·숫자·특수문자 각 1개 이상 (한글·공백 불가)",
  "challengeId":"발급된 UUID",
  "proof":"확인 응답의 proof",
  "consents":[
    {"kind":"TERMS","policyVersion":"dev-v1","agreed":true},
    {"kind":"PRIVACY","policyVersion":"dev-v1","agreed":true}
  ]
}
~~~

가입 후 /auth/login에 email,password를 보내 로그인합니다.
dev-v1은 개발용 버전 표식이며 실제 약관·개인정보 처리방침의 확정 문구를 의미하지 않습니다.
운영에서는 확정한 POLICY_VERSION과 프런트엔드 동의 문구를 일치시켜야 합니다.

전화 인증은 로그인 후 A02에 아래 값을 보내고 같은 A03으로 확인합니다.

~~~json
{"purpose":"PHONE","target":"01012345678","consent":{"kind":"PHONE","policyVersion":"dev-v1","agreed":true}}
~~~

새 전화 인증을 요청하면 이전 전화 인증 상태를 해제합니다. 실제 운영 발송에는 SOLAPI 설정이 필요합니다.
비밀번호 재설정은 purpose=RESET의 이메일 증명으로 /auth/password-reset에 challengeId,proof,newPassword를 보냅니다.
기존 회원 여부와 무관하게 RESET 접수 응답 형식은 같습니다.

## 물품·검색·지도

업로드는 multipart의 file 필드입니다. JPEG/PNG/WebP, 10MB 이하, 정제 후 WebP로 저장합니다.
사진 응답의 photoId를 물품의 photoIds[1..5]에 넣습니다. 본인의 미사용 READY 사진만 연결할 수 있습니다.

~~~json
{
  "name":"파란 이어폰 케이스",
  "category":"ELECTRONICS",
  "publicFeatures":"별무늬 스티커",
  "foundAt":"2026-11-01T14:00:00+09:00",
  "foundLocation":{"label":"한성대학교 도서관","lat":37.582,"lng":127.01},
  "photoIds":["업로드 응답의 UUID"],
  "storagePlace":"도서관 안내데스크",
  "pickupGuide":"운영 시간에 방문",
  "privateFeatures":"공개하지 않을 소유 확인 단서"
}
~~~

일반 검색: q,place,foundFrom,foundTo,cursor,limit(기본 20/최대 50).
검색어는 공백으로 나눕니다. 모든 단어가 물품명 또는 공개 특징에 있어야 하며, 단어 순서는 무관합니다. 장소와 습득 기간도 동시에 적용합니다. 예를 들어 이름이 ‘이어폰’이고 공개 특징이 ‘검정 케이스’인 물품은 `q=검정 이어폰`으로 찾을 수 있습니다.
앱의 기간 필터(전체·최근 7일·최근 30일)는 기존 `foundFrom`과 `foundTo`를 사용합니다. 검색 시각을 한 번 정해 종료 시각으로 쓰고, 7일·30일은 해당 시간만큼 뺀 시작 시각도 보냅니다. 전체 기간은 시작 시각을 생략합니다. 양쪽 경계를 포함하며 시각은 시간대가 있는 ISO 문자열입니다. 다음 페이지에는 첫 요청의 조건과 시각을 그대로 두고 응답의 `meta.nextCursor`를 전달합니다.
목록은 `data[]`, 상세(`GET /api/v1/items/{id}`)는 `data`에 같은 공개 물품 형식을 담습니다. 앱에서는 공개 설명을 `publicFeatures`, 장소명을 `foundLocation.label`, 보관 장소를 `storagePlace`, 수령 안내를 `pickupGuide`에서 읽습니다. 공개 설명과 수령 안내는 비어 있을 수 있습니다. 두 조회 모두 로그인 없이 사용할 수 있습니다.
AVAILABLE·RESERVED만 기본 검색에 나오며 RETURNED의 상세 직접 조회는 유지합니다.

근처 검색: lat,lng 필수, radiusM=500|1000|3000(기본 1000), category=ALL|ELECTRONICS|WALLET_BAG,
registeredDays=ALL|7|30, q?,cursor?,limit?(최대 100).
거리순으로 반환하고 공개 DTO에 distanceM을 추가합니다. 최대 100건 이후는 truncated=true이므로 반경·조건을 좁힙니다.
지도 이동 시점이 아닌 “이 지역 재검색” 버튼에서 요청하는 것은 프런트엔드의 역할입니다.

장소 검색: /places?q=한성대&lat=37.582&lng=127.01. 좌표는 둘 다 생략하거나 둘 다 보냅니다.
KAKAO_REST_API_KEY가 없으면 가짜 장소를 반환하지 않고 503 PLACES_NOT_CONFIGURED를 반환합니다.

분실 신고는 name,features?,lostTime,lostLocation을 보냅니다. 공개 검색 대상이 아니며 본인만 조회할 수 있습니다.
lostTime은 start,end,precision(EXACT|APPROX|DATE)입니다. EXACT는 두 시각이 같아야 합니다.
시간대 포함 ISO 시각을 사용하고 미래·역전 시간, 범위 밖 좌표를 거절합니다.

## 주인 확인·대화·반환

A19 입력은 features(1~300자),lostTime,lostLocation입니다. 전화 인증, 자기 물품 아님, AVAILABLE 상태를 검사합니다.
같은 회원의 활성 요청은 하나만 허용합니다.

A21은 {decision:"APPROVE"} 또는 {decision:"REJECT",reason:"사유"}입니다. 거절 사유는 1~300자입니다.
승인은 선택 요청 APPROVED + 나머지 PENDING 요청 CLOSED + 물품 RESERVED를 한 트랜잭션에서 처리합니다.
동시에 승인해도 DB 제약과 잠금으로 하나만 승인됩니다.

A23은 {body:"메시지",clientMessageId:"UUID"}입니다. 메시지는 1~200자 일반 텍스트로 렌더링합니다.
A22는 최초 최근 50건을 시간순으로 반환합니다. nextCursor를 after에 넣어 새 메시지를 조회하고
previousCursor를 before에 넣어 과거를 조회합니다. limit은 1~50이며 after와 before를 함께 보내지 않습니다.
반환 후에는 기존 대화 읽기와 이미 저장된 메시지의 재전송만 허용합니다.

A24·A25 입력은 빈 JSON 객체 {}입니다.

| 동작 | 주체 | 요청 상태 | 물품 상태 |
|---|---|---|---|
| 승인 | 보관자 | APPROVED | RESERVED |
| 전달 표시 | 보관자 | HANDED_OVER | RESERVED |
| 수령 확인 | 요청자 | RETURNED | RETURNED |

전달만으로 반환 완료가 되지 않습니다. 승인 취소·자동 반환·분쟁 자동 판정은 구현 범위가 아닙니다.
의심 요청 신고 A27은 {reason:"1~200자"}이며 접수만 합니다. 같은 신고자의 같은 요청은 기존 reportId를 돌려줍니다.
신고 자체로 요청 상태나 계정을 바꾸지 않습니다.

## 내역과 비공개 정보

/me/history?type=LOST_REPORTS|MY_CLAIMS|MY_ITEMS|RECEIVED_CLAIMS&cursor&limit

공개 물품에는 보관자 ID·연락처·비공개 특징을 넣지 않습니다. 관리 상세는 해당 보관자만,
요청·대화는 해당 관계자만, 신고 접수는 신고자만 조회합니다. 타인의 비공개 자원에는 404를 반환합니다.
모든 문자열 길이는 TRD 2.2의 엄격한 기준을 따릅니다.
