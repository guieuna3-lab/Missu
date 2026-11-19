# MissU 백엔드

분실물·습득물 등록부터 주인 확인, 대화, 반환 완료까지 처리하는 NestJS 백엔드입니다. 핵심 업무 API와 본인 하루 이동 경로 API를 구현하고 Windows 로컬 PostgreSQL에서 검증했습니다. 조원의 정식 프론트엔드는 이 API에 연결하면 됩니다.

정리 기준: **2026-11-05**. 마지막 기능 검증: **2026-11-04**. 운영 배포가 끝난 서비스는 아니며, 실제 이메일/SMS 발송과 모바일 백그라운드 위치 수집 등은 아래 남은 작업을 확인하세요.

## 기술 구성

- Node.js + NestJS + TypeScript
- PostgreSQL + Prisma ORM / 버전별 DB migration
- DB 세션과 HttpOnly 쿠키, CSRF·Origin 검사
- 비밀번호 Argon2 해시, 비공개 특징·위치 좌표 AES-256-GCM 암호화
- Swagger / OpenAPI 명세, Jest·Supertest 검증

기능을 추가하면서 기본 Hello World 코드를 보존했고 주요 업무 코드에 한국어 주석을 달았습니다. 패키지 버전은 `package-lock.json`을 기준으로 설치합니다.

## 구현한 기능

| 영역 | 내용 |
| --- | --- |
| 회원·인증 | 동의·이메일 인증 후 가입, 로그인/로그아웃, 전화 인증, 비밀번호 재설정, 세션 만료·인증번호 제한 |
| 습득물 | 사진 검증·정제·등록, 공개 검색/상세, 보관자 전용 비공개 특징 조회 |
| 분실 신고 | 분실 장소·추정 시간·특징 등록, 본인 신고 조회 |
| 근처 검색 | 좌표 기준 500m/1km/3km, 종류·등록 기간 필터, 거리 정렬 |
| 주인 확인 | 전화 인증 회원의 요청, 보관자 승인/거절, 한 물품의 동시 승인 방지 |
| 대화·반환 | 승인 후 양측 대화, 메시지 중복 방지·페이지 조회, 전달 후 수령 확인, 반환 뒤 읽기 전용 |
| 내역·신고 | 내 등록·분실 신고·보낸 요청·받은 요청, 닉네임 수정, 의심 요청 신고 접수 |
| 하루 이동 경로 | 명시적 동의 후 기록, 본인 날짜별 조회, 암호화·48시간 보관, 중지·날짜/전체 삭제, 지점 주변 습득물 조회 |
| 개발 도구 | API 문서, 임시 자료 정리, 로컬 백업·복원 검증 스크립트, 합성 시연 데이터, 부하 시험 도구 |

반환 흐름은 `PENDING → APPROVED → HANDED_OVER → RETURNED`입니다. **보관자가 전달했다고 최종 반환 완료가 되지 않으며 요청자의 수령 확인이 필요합니다.** 다른 요청은 상황에 따라 `REJECTED` 또는 `CLOSED`가 됩니다.

최신 OpenAPI에는 39개 HTTP 동작(기본 응답·상태 확인 포함)이 있습니다. 하루 경로 API 7개는 [동선 계약](docs/DAILY_ROUTES.md)을 참고하세요.

## DB도 저장소에 포함됩니다

실제 DB 내용 대신 **DB를 재현하는 설계와 생성 코드를 포함**합니다.

| 포함 파일 | 역할 |
| --- | --- |
| `prisma/schema.prisma` | 16개 모델의 테이블·컬럼·관계 정의 |
| `prisma/migrations/` | 기존 자료를 보존하며 순서대로 적용할 테이블 생성·변경 SQL |
| `prisma.config.ts` | DB 연결 문자열을 환경 설정에서 읽는 Prisma 설정 |
| `scripts/local-db.mjs` | 새 Windows 개발 DB·시험 DB와 로컬 설정 준비 |
| `scripts/seed-demo.mjs`, `scripts/demo-mvp.mjs` | 합성 시험 자료·시연 흐름 생성 |
| `.env.example` | 필요한 설정의 예시. 실제 비밀번호·키 없음 |

**실제 DB 폴더·덤프, 회원/대화/위치 데이터, 업로드 사진, `.env`, `.local`, API 키는 저장소에 올리지 않습니다.** `node_modules`, `dist`, 자동 생성 Prisma 클라이언트도 제외하며 설치·빌드 과정에서 다시 만듭니다. 팀 공용 데이터가 필요하면 별도 개발용 PostgreSQL에 연결하고 자격증명은 저장소 밖에서 관리합니다.

## 새 Windows PC에서 실행

백엔드 폴더에서 실행합니다. Node.js/npm과 PostgreSQL이 필요합니다. 검증한 로컬 환경은 Node.js 26.13.0, npm 11.20.0, PostgreSQL 17.11입니다.

1. `npm.cmd ci`로 의존성을 설치합니다.
2. [로컬 설치 안내](docs/LOCAL_SETUP.md)에 따라 PostgreSQL Windows 바이너리의 `bin`, `lib`, `share`가 `.local/pgsql` 아래에 있도록 준비합니다. 기존 DB를 사용하는 경우 임의 초기화하지 말고 해당 연결 설정을 따릅니다.
3. 새 로컬 DB 방식은 아래 순서로 실행합니다. **이 방식을 사용할 때 `.env.example`의 예시 비밀번호를 먼저 `.env`에 복사하지 마세요.** `local:setup`이 새 비밀번호와 암호화 키를 생성합니다.

```powershell
npm.cmd run local:setup
npm.cmd run prisma:generate
npm.cmd run db:migrate
npm.cmd run seed:demo
npm.cmd run start:dev
```

다음부터는 DB와 서버가 꺼져 있을 때 아래를 실행합니다.

```powershell
npm.cmd run db:start
npm.cmd run start:dev
```

- API 문서: http://localhost:3000/docs
- DB 연결 확인: http://localhost:3000/health/ready
- 기본 API 주소: http://localhost:3000/api/v1
- 로컬 DB 포트: `54329` / 개발 DB: `missu_dev` / 시험 DB: `missu_test`

서버 터미널은 열어둡니다. 이미 실행 중이면 같은 포트로 중복 실행하지 않습니다. `localhost`는 각자의 PC이므로 조원이 이 주소만 전달받아 다른 노트북의 서버에 접속할 수는 없습니다. 공동 접속은 별도 개발 서버가 필요합니다.

Linux/macOS 또는 공용 PostgreSQL에서는 Windows 전용 `local:*` 스크립트 대신 DB·계정과 `.env`를 별도로 준비한 뒤 Prisma 생성·migration·서버 명령을 사용합니다. Windows 외의 새 설치는 이번 작업에서 검증하지 않았습니다.

## 프론트엔드 연결

1. `GET /api/v1/auth/csrf`에서 CSRF 토큰을 받습니다.
2. 변경 요청에는 `X-CSRF-Token`, 브라우저 요청에는 `credentials: 'include'`를 사용합니다. 로그인 후 받은 새 CSRF 토큰으로 교체합니다.
3. 물품 등록·주인 확인·승인/거절·반환 등 지정 API에는 UUID `Idempotency-Key`를 전달합니다. 메시지는 본문의 `clientMessageId`, 경로는 기록/지점 ID로 중복을 방지합니다.
4. 프론트엔드 주소를 백엔드 `ALLOWED_ORIGINS`와 일치시킵니다. 개발 프록시를 사용하면 `/api/v1`로 호출할 수 있습니다.
5. 실제 입력·응답·오류 구조는 [OpenAPI](docs/openapi.json), [연결 안내](docs/FRONTEND_CONNECTION.md), [동선 안내](docs/DAILY_ROUTES.md)를 따릅니다.

별도 `missu-frontend-preview`는 백엔드를 시험하는 임시 웹 화면입니다. 조원 화면과 분리되어 있어 교체할 수 있으며 백엔드 저장소의 필수 구성 요소는 아닙니다. 임시 화면의 `/__preview/*`는 정식 백엔드 API가 아닙니다.

## 이동 경로와 지도

- 로그인한 본인의 기록만 읽고 쓸 수 있습니다. 시작 전 경로는 복원하지 않습니다.
- 좌표·정확도는 암호화하고 관측 시각부터 48시간이 지나면 조회에서 제외합니다. 서버가 실행 중이면 30초 간격으로 삭제하며, 꺼져 있었다면 다음 시작 때 정리합니다.
- 제공된 로컬 백업 스크립트는 경로 테이블의 데이터를 제외합니다. 운영 스냅샷·복제 등의 보관 정책은 별도 설정해야 합니다.
- 시험 웹 화면은 탭을 숨기거나 닫으면 수집을 중지합니다. **화면을 꺼도 기록하는 기능은 모바일 앱의 별도 백그라운드 위치 수집 구현이 필요합니다.**
- 구글 지도는 별도 시험 프론트엔드에서 연결했습니다. 사용자가 키를 직접 입력했고 지도와 파란 경로선 표시를 확인했습니다. 지도 키는 팀 공유 파일에 포함하지 않습니다.
- `GET /api/v1/places?q=검색어`는 카카오 로컬 API로 장소명·도로명·지번 주소를 조회합니다. 카카오디벨로퍼스에서 앱의 카카오맵 사용을 켜고 Render의 `missu-api` 환경에 `KAKAO_REST_API_KEY`를 저장하세요. `PLACE_PROVIDER`를 명시한 환경은 `kakao`로 설정합니다. 앱에는 검색 결과의 이름·주소·좌표가 전달됩니다.

## 검증 결과

2026-11-04 기준:

- 백엔드 빌드·정적 검사 통과
- 단위 테스트 **6개**, PostgreSQL 통합 테스트 **52개** 통과
- 별도 시험 프론트엔드 자동 테스트 **13개** 통과
- 합성 계정으로 등록 → 요청 → 승인 → 대화 → 전달 → 수령 완료 흐름을 브라우저에서 확인
- 경로 6지점 저장·본인 조회·타 계정 비노출·주변 물품 조회·새로고침 후 유지 확인
- 구글 지도와 경로선 표시는 사용자 확인. 실제 GPS 이동과 모바일 백그라운드 기록은 미검증

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd test -- --runInBand
npm.cmd run test:e2e
```

통합 시험 스크립트는 지정된 로컬 `missu_test` DB에서만 실행합니다. 11월 3일의 MVP 검증 문서는 당시 결과이며, 동선 추가 후 현재 상태는 이 README와 `docs/DAILY_ROUTES.md`가 기준입니다. 전체 문서의 모든 인수 시험이나 운영 성능을 완료했다는 뜻은 아닙니다.

## 남은 연결 작업과 보류 범위

- 조원 프론트엔드와 실제 API 연결 및 전체 사용자 흐름 검증
- 실제 이메일·SMS 발송: 제공사 연결 코드는 있으나 로컬 인증번호 파일로 시험 중
- 장소 이름 검색, 원격 사진 저장소·공용 DB 등의 실제 서비스 설정·검증
- 실제 모바일 GPS·백그라운드 기록, 운영 HTTPS·배포·CI/CD·모니터링·운영 백업
- 운영 약관·개인정보 보유/삭제 정책과 신고 처리 절차 확정

사용자의 최신 요청에 따라 **QR 연락, 조건 알림, 사용자 차단, 소셜 로그인, AI 매칭, 관리자 화면 등 다른 부가 기능은 보류**했습니다. 이번 공유본에는 이 기능들이 구현된 것처럼 표시하지 않습니다.

## 주요 폴더

```text
src/auth/            가입·인증·세션
src/items/           습득물·검색·주변 탐색
src/lost-reports/    분실 신고
src/claims/          주인 확인·대화·반환·신고
src/routes/          본인 하루 경로·48시간 보관
src/integrations/    외부 발송·저장소 연결 코드
prisma/             DB 설계·migration
scripts/            설치·시연·검증·운영 도구
test/               통합 테스트
docs/               API·설치·운영·진행 기록
```

API 문서의 `0.2.0` 표시와 별도로 이번 공유본에는 동선 API 7개가 추가되어 있습니다. 코드·DB migration·API 문서를 함께 사용하세요.

## 2026-11-20 분실 신고 매칭 알림

위 초기 공유본의 보류 목록 중 **조건 알림**을 이번에 구현했습니다. 본인 분실 신고에서 명시적으로 켠 뒤 새로 등록·보관 확인되는 회원·공공기관·한성대 물품을 비교합니다. 물품명은 검색 동의어를 재사용하고, 본체와 액세서리를 구별하며, 분실 장소명 또는 약 3km 내 공개 위치가 맞아야 후보로 알립니다. 소유권 판정은 아닙니다. 같은 신고·물품 쌍의 알림은 한 번만 저장됩니다.

- `GET /api/v1/notifications`: 본인 알림 목록, 50건 단위 cursor.
- `POST /api/v1/notifications/:id/read`: 본인 알림 읽음 표시.
- `GET/PUT /api/v1/notifications/reports/:id`: 본인 신고 알림 상태 조회/동의·해제(`enabled`).
- `POST/DELETE /api/v1/notifications/devices`: 로그인한 수신 기기 등록/해제(`token`, `binding`).

`202611200002_match_notifications`는 작은 신규 알림 테이블과 등록·수집 트리거를 추가합니다. 기존 물품 전체를 다시 분류하지 않습니다. 동의 이후 이벤트만 대기열에 저장하고 서버가 1분마다 처리합니다. 중복 저장 방지, 다른 계정 접근 차단, 수신 기기 토큰 암호화, 발송 실패 재시도(최대 6회), 오래된 예약 정리를 포함합니다. 동의를 끄거나 신고를 삭제하면 해당 신고의 발송 대기도 취소됩니다. 이미 발송 중인 네트워크 요청은 회수할 수 없습니다.

휴대폰 발송에는 `FIREBASE_SERVICE_ACCOUNT_JSON`이 필요합니다. Firebase 프로젝트에 발송 전용 계정을 만들고 `roles/firebasecloudmessaging.admin` 역할만 부여하여 JSON 키를 Render 비공개 환경 변수에 저장합니다. JSON 내용이나 키 파일을 GitHub·프론트 환경 변수·APK에 포함하지 않습니다. 이 값이 없으면 앱 안 알림은 작동하지만 푸시 기기 등록은 503과 준비 중 안내를 반환합니다.

Google FCM에는 수신 토큰·무작위 계정 연결값·알림 식별자만 전송합니다. 사용자의 위치·연락처·분실 특징은 전송하지 않습니다. 새 Android APK에서 알림 권한을 허용한 기기에 표시되고, iPhone 웹/기존 APK는 앱 안 알림을 이용합니다. 무료 Render 서버가 잠들었거나 수집·네트워크·기기 권한에 지연이 있으면 도착이 늦어질 수 있습니다. 즉시 도착을 보장하는 실시간 서비스는 아닙니다.
