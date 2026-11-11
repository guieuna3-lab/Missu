> 이 문서는 2026-11-03 MVP 작업 기록입니다. 이후 동선·구글 지도 추가와 현재 검증 결과는 [최신 README](../README.md) 및 [동선 안내](DAILY_ROUTES.md)를 우선 확인하세요.

# 미슈 백엔드 실행 안내

MVP의 업무 API 28개를 구현한 개발 버전입니다. 프런트엔드 화면은 별도 프로젝트에서 연결합니다.
실제 이메일·문자 발송, Kakao 검색, Supabase 사진 저장은 계정·키 설정 후 실서비스 검증이 필요합니다.
기본 개발 설정에서는 인증번호를 이 PC의 파일로만 확인하며 실제 메시지를 발송하지 않습니다.

## 1. VS Code에서 서버 실행

프로젝트 폴더: C:/Users/audwn/missu-backend

~~~powershell
cd C:/Users/audwn/missu-backend
npm.cmd run db:start
npm.cmd run start:dev
~~~

이미 같은 서버가 실행 중이면 두 번째 서버를 실행하지 않습니다. 마지막 명령이 실행 중인 터미널은 열어 둡니다.

- http://localhost:3000/docs — 입력·응답·필수 헤더를 포함한 API 문서
- http://localhost:3000/health/ready — DB와 최신 업무 테이블 확인
- http://localhost:3000/api/v1/items — 공개 물품 목록
- http://localhost:3000 — 보존한 Hello World 응답

기본 서버와 DB는 노트북 내부에서만 접근합니다. DB 포트는 54329, 개발 DB는 missu_dev, 시험 DB는 missu_test입니다.
휴대폰이나 팀원의 PC에서 접속하려면 별도 네트워크 설정 또는 시험 서버 배포가 필요합니다.

## 2. 가입부터 반환까지 전체 시연

새 터미널에서 같은 폴더로 이동한 뒤 실행합니다.

~~~powershell
npm.cmd run demo:mvp
~~~

처음 실행하면 합성 계정 두 개를 만들고 개발용 이메일·전화 인증, 사진 업로드, 물품 등록, 주인 확인 요청,
신고 접수, 승인, 대화, 보관자 전달, 요청자 수령 확인까지 실제 HTTP API로 처리합니다.
인증번호는 실제 발송되지 않으며 .local/outbox에 저장됩니다.
계정 비밀번호는 .local/mvp-demo-accounts.json에만 저장하고 채팅·소스 ZIP에는 넣지 않습니다.

다시 실행하면 같은 시연 계정으로 새 시연 물품을 추가합니다. 완료한 물품은 RETURNED이므로 기본 검색에 나오지 않고,
명령 끝에 표시되는 상세 주소로 확인합니다. 마지막 결과는 .local/last-mvp-demo.json에 있습니다.
신고 접수도 합성 자료이며 실제 운영자에게 통보하지 않습니다.

기존 간단 시연도 유지했습니다.

~~~powershell
npm.cmd run seed:demo
npm.cmd run demo
~~~

## 3. 이번 버전의 기능

| 영역 | 구현한 동작 |
|---|---|
| 계정 | 필수 동의·이메일 인증 후 가입, 로그인·로그아웃, 전화 인증·번호 변경 시 기존 인증 해제, 비밀번호 재설정 |
| 인증 보호 | 세션·CSRF·Origin, 인증번호 만료·시도 제한·재발송 제한, 증명 1회 사용, 재설정 후 기존 세션 무효 |
| 물품 | 사진 정제·등록, 공개 검색·상세, 등록자의 관리 상세, 분실 신고·본인 조회 |
| 지도 | 500/1000/3000m 반경, 종류·등록 기간, 거리 정렬, 최대 100건, Kakao 장소 검색 어댑터 |
| 요청 | 전화 인증 회원만 요청, 본인 물품·중복 활성 요청 금지, 보관자 승인·거절, 단일 승인·나머지 CLOSED |
| 대화·반환 | 승인 후 양측 대화, 메시지 중복 방지·페이지, 보관자 전달 후 요청자 수령 확인, 완료 후 읽기만 |
| 내것·신고 | 본인 신고·보낸 요청·등록 물품·받은 요청, 닉네임 수정, 의심 요청 신고·접수 조회 |
| 운영 도구 | 임시 데이터 정리, 로컬 DB·사진·키 백업, 새 임시 DB 복원 검증, API 문서 내보내기, 부하 시험 |

업무 테이블 13개와 공통 시도 제한 테이블 1개를 사용합니다.
프런트엔드 화면, AI 매칭, QR, 자동 동선 추적, 관리자 UI는 이 작업에서 구현하지 않았습니다.
회원·대화 등의 전체 개인정보 삭제 정책은 문서의 제안 값을 자동 확정하지 않고 운영 담당자 결정에 남겨 두었습니다.

## 4. 초보자를 위한 코드 읽기

1. src/main.ts — 서버 시작과 API 문서
2. src/missu.module.ts — 기능을 연결하는 모듈
3. src/auth/registration.controller.ts 및 registration.service.ts — 가입·인증
4. src/items/items.controller.ts 및 items.service.ts — 물품 API와 저장 규칙
5. src/claims/claims.controller.ts 및 claims.service.ts — 요청·대화·반환
6. prisma/schema.prisma — DB 설계
7. test/claims-mvp.e2e-spec.ts — 실제 반환 흐름과 권한 시험

주요 업무 코드에는 한국어 주석이 있습니다. src/generated/prisma는 자동 생성 코드이므로 직접 수정하지 않습니다.

## 5. 검사·종료

~~~powershell
npm.cmd run build
npm.cmd run lint
npm.cmd test -- --runInBand
npm.cmd run test:e2e
~~~

통합 시험은 missu_test만 사용합니다. 시험용 데이터를 구분해 정리하고 missu_dev는 초기화하지 않습니다.
서버는 실행 터미널에서 Ctrl+C로 종료합니다. DB도 종료하려면 실행합니다.

~~~powershell
npm.cmd run db:stop
~~~

API 연결은 API.md, 외부 키와 운영 도구는 OPERATIONS.md, 문서 해석 기준은 SOURCE_DECISIONS.md,
실제 검증 결과와 남은 외부 연동은 PROGRESS.md를 확인합니다.
