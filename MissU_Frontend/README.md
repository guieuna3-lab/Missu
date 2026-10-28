# MissU Frontend

React Native + Expo + TypeScript로 개발하는 미슈 모바일 앱이다.
현재는 Expo Router 기반 시작 화면과 타입·린트·포맷 검사를 제공한다. 백엔드 연동은 아직 없다.

## 실행 (Windows PowerShell / VS Code 터미널)

Node.js 22 LTS의 최신 패치 버전과 npm을 사용한다. 저장소 루트에서:

```powershell
cd MissU_Frontend
npm ci
npm start
```

휴대전화와 PC를 같은 네트워크에 연결하고 Expo Go로 개발 서버 QR을 연다.
기기에 설치된 Expo Go가 이 프로젝트 SDK를 지원하는지 먼저 확인한다.
지원하지 않는 네이티브 기능이나 SDK가 필요하면 Development Build가 필요하다.
네트워크·방화벽 때문에 연결되지 않을 수도 있다. Windows에서 iOS 시뮬레이터는 실행할 수 없다.
현재 설치 버전은 `package.json`과 `package-lock.json`을 기준으로 확인한다.

## 검사 명령

| 명령                   | 확인하는 것                   |
| ---------------------- | ----------------------------- |
| `npm run typecheck`    | TypeScript 타입 오류          |
| `npm run lint`         | 코드 규칙과 정적 오류         |
| `npm run format:check` | 포맷 일치 여부                |
| `npm run format`       | 코드·문서 포맷 정리           |
| `npm run check`        | 위의 타입·린트·포맷 검사 전체 |

검사를 통과해도 실기기·API 연동이 확인된 것은 아니다. `npm run ios`는 iOS 시뮬레이터 실행용이며 Windows의 첫 실행에는 사용하지 않는다.

## 현재 구조와 추가 원칙

- `src/app/_layout.tsx`: 공통 레이아웃·라우터.
- `src/app/index.tsx`: 개발 환경 확인용 시작 화면. 실제 홈 UI 설계가 아니다.
- `@/`: `src/`를 가리키는 별칭.
- 기능 추가 시 `src/features/`, 실제 공통 UI가 생기면 `src/components/`, API 공통 처리가 필요하면 `src/lib/`를 만든다.
- 라우트 폴더에는 화면 경로와 레이아웃만 둔다. 컴포넌트·데이터 파일을 넣으면 화면으로 해석될 수 있다.
- 전역 상태·폼·HTTP 라이브러리는 아직 추가하지 않았다. 필요가 확인되면 도입한다.

## 환경 변수

API 연동을 시작할 때만 `.env.example`을 `.env`로 복사하고 서버 주소를 입력한다.
실제 휴대전화에서는 PC의 `localhost`에 접근할 수 없다. PC LAN 주소 또는 팀 서버 주소를 사용한다.
`EXPO_PUBLIC_API_URL`은 공개 가능한 주소다. `EXPO_PUBLIC_` 변수에 비밀번호·서버 키·토큰을 넣지 않는다.
현재 시작 화면은 API 주소를 사용하지 않으므로 환경 변수 없이 실행할 수 있다.

## 개발 범위

회원가입·로그인, 분실 신고·습득물 등록, 검색·지도, 주인 확인·채팅·반환, 개인 내역.
아래 지침과 화면·API 계약을 확인한 뒤 기능 단위로 구현한다.

- [프론트 작업 지침](AGENTS.md)
- [협업 규칙](../docs/CONTRIBUTING.md)
- [에이전트 프롬프트](../docs/FRONTEND_PROMPTS.md)

## 참고

- https://docs.expo.dev/get-started/start-developing/
- https://docs.expo.dev/guides/environment-variables/
- https://docs.expo.dev/guides/using-eslint/
