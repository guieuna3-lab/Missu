# MissU

미슈(MissU) 분실물 탐색 및 반환 서비스.

| 경로 | 내용 |
| --- | --- |
| `MissU_Frontend/` | React Native + Expo + TypeScript 앱 (웹은 Render `missu-web`에 배포) |
| `missu-backend/` | NestJS + PostgreSQL(Prisma) 백엔드 (Render `missu-api`에 배포) |
| `docs/` | 협업·에이전트 작업 가이드 |

## 시작하기

- [프론트 실행 및 구조](MissU_Frontend/README.md)
- [프론트 에이전트 지침](MissU_Frontend/AGENTS.md)
- [백엔드 기능·실행 방법](missu-backend/README.md)
- [프론트 연결 방법(API 사용 규칙)](missu-backend/docs/FRONTEND_CONNECTION.md)
- [작업 요청 프롬프트](docs/FRONTEND_PROMPTS.md)
- [협업 규칙](docs/CONTRIBUTING.md)
- [이번 설정의 적용 방법과 효과](docs/SETUP_GUIDE.md)

## 현재 상태 (2026-11-23)

- 백엔드: 회원·인증, 습득물·분실 신고, 검색·근처 지도, 주인 확인 요청·승인, 대화·전달·수령, 내역·신고, 하루 이동 경로 API를 구현해 Render에 배포했다.
- 프론트: 필수 흐름 화면을 실제 API에 연결했고, 웹 버전을 Render에 배포했다.
- 배포 주소: 웹 https://missu-web.onrender.com · API https://missu-api-wkdu.onrender.com/api/v1
- `main`에 병합하면 Render가 웹과 API를 자동으로 다시 배포한다.
- 로그인 유지, 알림 목록 갱신, 통합 검색·기관 사진 표시를 연결했다. Android 1.2.1 APK에 푸시 수신을 포함했으며 실제 휴대전화 수신 확인은 남아 있다. iPhone iOS 16.4 이상은 홈 화면 웹 푸시를 지원한다. 네이티브 iOS 설치본의 배포·서명은 별도다.
- 사용 방법과 남은 검증 범위는 [백엔드 README](missu-backend/README.md)를 본다.
