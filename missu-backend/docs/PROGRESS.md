> 이 문서는 2026-11-03 MVP 작업 기록입니다. 이후 동선·구글 지도 추가와 현재 검증 결과는 [최신 README](../README.md) 및 [동선 안내](DAILY_ROUTES.md)를 우선 확인하세요.

# 미슈 백엔드 MVP 개발 인계 — 2026-11-03

## 현재 상태

개발 프로젝트는 C:/Users/audwn/missu-backend입니다. 최신 PRD/TRD와 프로그램 목록의 업무 API A01~A28을 구현하고 원본 프로젝트에 반영했습니다.
백엔드 MVP 코드와 로컬 검증이 완료된 상태입니다. 프런트엔드 연결·실제 외부 발송/지도/원격 사진·운영 배포까지 끝난 앱 완성본은 아닙니다.
프런트엔드는 사용자가 별도로 구현 중이므로 수정하지 않았습니다. 원본 문서 10개도 보존했습니다.

기존 기본 코드와 Observe 설정을 보존하고 새 기능에는 한국어 주석을 달았습니다. 기존 .env의 비밀번호·암호화 키는 변경하지 않았습니다.
업무 테이블 13개와 횟수 제한 보조 테이블 1개를 사용하며, 새 DB 변경은 기존 데이터를 삭제하지 않는 migration으로 적용했습니다.
작업용 복사본은 Documents/Codex/2026-11-02/referenced-chatgpt-conversation-this-is-an/work/missu-backend이며, 이후 실제 개발은 원본 폴더에서 이어갑니다.

## 구현 범위

- 필수 동의·이메일 인증 후 가입, 로그인·로그아웃, 전화 인증, 비밀번호 재설정과 기존 세션 만료
- 인증번호 만료·오입력/재발송 제한, 세션·CSRF·Origin 검사, 권한과 중복 요청 검사
- 사진 검증·정제·비공개 저장, 습득물·분실 신고 등록, 공개 검색·상세와 등록자 관리 상세
- 거리순 근처 검색, 반경·종류·기간 필터, Kakao 장소 검색 연동 코드
- 주인 확인 요청, 단일 승인·거절·다른 요청 종료, 승인 후 양측 대화
- 보관자 전달 → 요청자 수령 확인 순서로 최종 RETURNED 처리
- 본인 내역 4종, 닉네임 수정, 의심 요청 신고와 접수 결과
- 만료 자료 정리, 로컬 DB·사진·키 백업과 복원 검증, API 명세, 부하 시험 도구

API 입력·응답은 docs/API.md와 docs/openapi.json에 정리했습니다. 28개 업무 API와 사진·상태 확인·기본 응답을 합쳐 32개 HTTP 동작입니다.

## 실제 검증 결과

- 빌드·정적 검사 통과, 단위 시험 6개·실제 PostgreSQL 통합 시험 42개 통과
- 권한, 인증 만료·재사용·동시 요청, 승인 경합, 메시지 중복·페이지, 반환 상태, DB 제약, 정리 범위 검사
- 원본 프로젝트에서도 DB migration·Prisma 생성·빌드 성공, HTTP API 명세 버전 0.2.0 확인
- 합성 계정으로 가입·전화 인증 → 사진·물품 등록 → 요청·신고·승인 → 대화 → 전달 → 수령 완료 시연 성공
- 보관자 전달 직후에는 RESERVED 유지, 요청자 수령 확인 뒤 RETURNED, 공개 상세의 비공개 특징 제외 확인
- 변경 전과 시연 후 각각 DB·사진·설정을 백업하고, 새 임시 DB로 복원해 행 수·사진 해시·암호화 키 검증 성공

부하 시험은 Windows 로컬 시험 DB의 물품 10,000건·사진 메타데이터 30,000건에서 동시 사용자 30명,
60초 예열 후 300초 동안 측정했습니다. 총 29,578건, 실패 0건,
조회 P95 634.8ms, 변경 P95 564.73ms입니다.
검색·상세·근처 JSON 조회와 분실 신고 쓰기만 측정했습니다. 사진 다운로드·외부 발송·프런트엔드·운영 성능은 포함하지 않습니다.
원본 수치는 docs/LOAD_REPORT.json에 있습니다.

## 실행과 시연

기존 localhost:3000 서버가 새 API 0.2.0을 제공하는 것을 확인했습니다. 기존 서버와 DB는 계속 실행 중입니다.

서버가 꺼져 있을 때 VS Code 터미널에서 실행합니다.

~~~powershell
cd C:/Users/audwn/missu-backend
npm.cmd run db:start
npm.cmd run start:dev
~~~

- http://localhost:3000/docs — API 명세와 시험 화면
- http://localhost:3000/health/ready — DB 연결 상태
- http://localhost:3000/api/v1/items — 공개 물품 목록

다른 터미널에서 npm.cmd run demo:mvp를 실행하면 같은 시연 계정으로 새 합성 물품을 추가해 전체 반환 흐름을 다시 시연합니다.
계정 정보는 .local/mvp-demo-accounts.json, 마지막 결과는 .local/last-mvp-demo.json에만 보관합니다.
반환 완료한 시연 물품은 기본 목록에서 제외되며 상세 주소로 조회합니다. 기존 1단계 시연 데이터도 남아 있습니다.

## 백업

이번 변경 전 데이터 백업: C:\Users\audwn\missu-backend\.local\backups\2026-11-03T05-55-03-776Z-7f1997b5

전체 시연 후 데이터 백업: C:\Users\audwn\missu-backend\.local\backups\2026-11-03T05-56-41-359Z-46470cd4

위 로컬 백업에는 DB·사진·private.env가 들어 있습니다. 비밀 설정을 포함하므로 팀 공유용 ZIP과 구분합니다.
공유용 소스와 인계 파일은 다음 폴더에 있습니다.

C:/Users/audwn/Documents/Codex/2026-11-02/referenced-chatgpt-conversation-this-is-an/outputs

- missu-backend-original-source-backup.zip — 최초 NestJS 소스 보존
- missu-backend-before-mvp-20261103.zip — 이번 확장 전 소스 보존
- missu-backend-mvp-source-20261103.zip — 최신 MVP 소스
- 미슈_백엔드_MVP_개발인계_2026-11-03.md — 이 문서의 전달용 사본

소스 ZIP에는 .env·.local·DB·사진·비밀번호·node_modules·빌드 결과·자동 생성 코드를 넣지 않았습니다.
새 PC 설치는 docs/LOCAL_SETUP.md, 데이터 백업과 운영 도구는 docs/OPERATIONS.md를 따릅니다.
이 백업은 프로젝트 자료이며 노트북 전체의 백업은 아닙니다.

## 남은 연결 작업

1. 프런트엔드에서 API 계약에 맞게 쿠키·CSRF·입력/응답을 연결하고 실제 화면 흐름을 시험합니다.
2. 이메일·SMS·Kakao·Supabase 계정과 키를 설정한 뒤 실제 수신·검색·사진 저장을 검증합니다. 현재 인증번호는 로컬 파일로만 확인합니다.
3. 실제 약관·개인정보 보유/삭제 정책과 정책 버전을 확정합니다. dev-v1은 개발용 표식입니다.
4. 서비스 서버·HTTPS·운영 백업/정리 일정·접근 설정을 구성하고 실제 단말에서 검증합니다.

AI·QR·자동 동선 추적·관리자 화면은 최신 MVP 범위에 포함하지 않았습니다. 전화 인증은 번호 접근 확인이며 물품 소유권 증명이 아닙니다.
문서 사이의 차이는 docs/SOURCE_DECISIONS.md에 기록했습니다. 이전 1단계 인계 문서의 미구현 목록은 과거 상태이며 이 문서가 최신입니다.
