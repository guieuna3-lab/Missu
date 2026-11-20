# 조원 프론트엔드 연결 계약

백엔드 API 상세 명세: 실행 중인 백엔드의 <http://localhost:3000/docs>.

## 현재 팀 앱의 인증과 요청 (2026-11-20)

현재 팀 웹·앱은 `POST /api/v1/auth/mobile/login`에 `{email, password}`를 보내고
`{data: {user, accessToken, expiresAt}}`를 받습니다. 업무 API는
`Authorization: Bearer <accessToken>`, `credentials: 'omit'`으로 호출합니다.
쿠키와 Bearer를 같은 업무 요청에 섞지 않습니다. 회원 정보는 `GET /api/v1/me`입니다.

로그인 유지는 아래 별도 복원 자격을 사용합니다. 비밀번호는 저장하지 않습니다.

| 대상                                  | 보관·복원                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 배포 웹·홈 화면 웹·웹 기반 Android 앱 | 같은 출처의 `POST /session-api/save`(로그인 Bearer), `restore`, `forget`. 모두 `X-Missu-Session: 1`과 `credentials: same-origin`. HttpOnly 쿠키는 JS에서 읽지 않음 |
| 네이티브 Expo 앱                      | `POST /auth/mobile/remember`(로그인 Bearer)로 받은 `data.token`을 SecureStore에 저장. `mobile/restore`, `mobile/forget`에는 `{token}` 전송                         |

웹의 `/session-api/*`는 API의 `/api/v1/auth/browser/*`로 rewrite합니다.
Render 대시보드에서 직접 만든 정적 사이트라면 YAML만 커밋하지 말고 같은 규칙을 SPA의 `/* → /index.html` **앞에** 추가해야 합니다.
복원은 `data.user`, `data.accessToken`, `data.expiresAt`를 돌려줍니다.
복원 자격은 최대 7일이며 갱신해도 절대 만료가 늘어나지 않습니다. 앱 토큰의 30분 미사용 제한은 유지합니다.
로그아웃·비밀번호 변경/재설정·탈퇴 후에는 복원이 거절됩니다.
Origin·전용 헤더 검사를 우회하거나 복원 토큰을 웹 localStorage에 저장하지 마세요.

물품 등록·반환 결정 등 지정된 변경은 UUID `Idempotency-Key`를 사용하고,
메시지는 `clientMessageId`로 재시도 중복을 방지합니다.

## 기존 쿠키 API를 사용하는 별도 클라이언트

아래 계약은 기존 쿠키 클라이언트 호환용입니다. 현재 팀 앱의 Bearer 호출과 혼합하지 않습니다.

1. 먼저 `GET /api/v1/auth/csrf`를 호출해 `data.csrfToken`을 보관합니다.
2. 로그인·가입 등 변경 요청에 `X-CSRF-Token`을 넣습니다. 브라우저 `fetch`에는 `credentials: 'include'`를 지정합니다.
3. `POST /api/v1/auth/login`의 입력은 `{email, password}`입니다. 응답의 새 `data.csrfToken`으로 교체합니다. 세션 쿠키는 브라우저가 보관하며 로그인 토큰을 localStorage에 따로 저장하지 않습니다.
4. `GET /api/v1/me`로 현재 사용자를 읽습니다. 401이면 로그인 화면을 제공합니다.
5. 물품·분실 신고·소유 확인 요청·승인/거절·신고·전달/수령 요청에는 UUID `Idempotency-Key` 헤더가 필요합니다. 같은 작업의 실패 후 재시도에는 같은 키를 사용하고 입력이 바뀌면 새 키를 만듭니다.
6. 메시지는 헤더 대신 본문의 `clientMessageId` UUID로 중복을 방지합니다.

`POST /api/v1/uploads`는 `FormData`의 `file` 필드를 사용합니다. 브라우저가 multipart 경계를 정하므로 `Content-Type`을 직접 지정하지 않습니다. 응답의 `photoId`를 물품 등록 `photoIds`에 넣습니다.

응답은 일반적으로 `{data: ...}`, 목록은 `{data: [...], meta: {nextCursor}}`입니다. 메시지 목록은 `data.messages`입니다. 오류는 `{error: {code, message, requestId, fields?}}`입니다. 로그아웃 성공 응답은 204라 JSON 본문이 없습니다.

## 핵심 상태

```text
물품: AVAILABLE → RESERVED → RETURNED
요청: PENDING → APPROVED → HANDED_OVER → RETURNED
                    ↘ 승인 뒤 대화 가능
```

보관자만 승인/거절·전달·의심 요청 신고를 할 수 있습니다. 요청자만 수령을 확인합니다. **보관자가 전달했다고 물품을 반환 완료로 표시하면 안 됩니다.** 최종 수령 응답과 서버 상태를 기준으로 표시합니다. 반환 후 메시지는 읽기 전용입니다.

비공개 특징은 공개 상세 응답에 없습니다. 보관자용 `GET /items/:id/manage`에서만 읽습니다. 다른 사용자에게는 404가 정상 응답입니다. 거절·종료된 요청도 서버 응답 상태를 그대로 표시합니다.

## API 영역

| 기능      | 경로 (`/api/v1` 생략)                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 인증      | `/auth/csrf`, `/auth/login`, `/auth/logout`, `/auth/challenges`, `/auth/challenges/:id/verify`, `/auth/signup`, `/auth/password-reset` |
| 사용자    | `/me`, `/me/history?type=MY_ITEMS\|MY_CLAIMS\|RECEIVED_CLAIMS\|LOST_REPORTS`                                                           |
| 물품      | `/items`, `/items/:id`, `/items/:id/manage`, `/items/nearby`                                                                           |
| 사진      | `/uploads`, `/photos/:id` (서버가 반환한 서명 URL 사용)                                                                                |
| 분실      | `/lost-reports`, `/lost-reports/:id`                                                                                                   |
| 요청      | `/items/:id/claims`, `/claims/:id`, `/claims/:id/decision`                                                                             |
| 대화·반환 | `/claims/:id/messages`, `/claims/:id/handover`, `/claims/:id/receipt`                                                                  |
| 신고      | `/claims/:id/reports`, `/reports/:id`                                                                                                  |
| 장소      | `/places` (외부 서비스 미설정 시 503)                                                                                                  |

주변 검색은 `lat`, `lng`, `radiusM=500|1000|3000`, `category=ALL|ELECTRONICS|WALLET_BAG`, `registeredDays=ALL|7|30`을 사용합니다. 날짜는 API 전송 전에 ISO 8601 문자열로 변환하고 좌표는 숫자로 보냅니다. 필드별 필수 조건과 길이는 Swagger를 기준으로 맞춥니다.

이 프로젝트의 `/__preview/*`는 개발 편의를 위한 **테스트 화면 전용 경로**입니다. 조원의 정식 프론트엔드와 운영 백엔드에는 포함하지 않습니다. 정식 화면은 표준 `/api/v1/auth/login`을 사용합니다.

API를 직접 호출하는 다른 출처의 웹앱에서는 백엔드 `ALLOWED_ORIGINS`를 실제 화면 주소와 정확히 맞추고 세션 쿠키·HTTPS 설정을 환경에 맞게 검증해야 합니다. 네이티브 모바일 앱은 사용하는 HTTP 라이브러리에 맞춰 쿠키 저장과 CSRF 흐름을 구현해야 합니다.

## 하루 이동 경로

`/api/v1/me/routes` 아래 API 7개는 [동선 연결 계약](DAILY_ROUTES.md)과 [OpenAPI](openapi.json)를 따릅니다. 기존 변경 요청과 동일하게 쿠키·CSRF·Origin이 필요합니다. 위치 기록의 동의·중지·48시간 보관 안내는 정식 화면에서도 유지하세요.
