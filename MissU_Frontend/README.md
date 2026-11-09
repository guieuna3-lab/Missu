# MissU Frontend

React Native + Expo + TypeScript로 개발하는 미슈 모바일 앱이다.
Figma 1번 영역의 환영, 홈, 내역, 로그인 안내, 등록 물품과 프로필 수정 화면,
2번 영역의 로그인·회원가입·비밀번호 재설정, 3번 영역의 습득물 검색·상세, 10번 영역의 근처 화면을 제공한다.
백엔드·실제 인증 연동은 아직 없고, 2번 영역은 개발용 모의 인증으로 동작한다.
구현 범위와 검증 기록은 [1번 영역](docs/AREA_ONE.md), [3번 영역](../docs/SEARCH_IMPLEMENTATION.md)을 확인한다.

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
- `src/app/index.tsx`: 기본 환영 화면. 개발용 guest/member 미리보기에서는 홈으로 이동한다.
- `src/app/search/index.tsx`: 검색 전·조건·결과·결과 없음 화면.
- `src/app/items/[id].tsx`: 물품 상세와 비회원·회원별 하단 버튼.
- `src/app/nearby.tsx`: 근처 예시 지도·목록·장소 검색. [근처 구현 안내](../docs/NEARBY_IMPLEMENTATION.md).
- 검색 예시·팀원 연결 지점·검증 기록: [검색 구현 안내](../docs/SEARCH_IMPLEMENTATION.md).
- `@/`: `src/`를 가리키는 별칭.
- 기능 추가 시 `src/features/<기능>/`에 화면을 두고, 두 곳 이상에서 쓰는 UI만 `src/components/`로 올린다. API 공통 처리는 `src/lib/`에 둔다.
- 라우트 폴더에는 화면 경로와 레이아웃만 둔다. 컴포넌트·데이터 파일을 넣으면 화면으로 해석될 수 있다.
- 전역 상태·폼·HTTP 라이브러리는 아직 추가하지 않았다. 필요가 확인되면 도입한다.

## 환경 변수

API 연동을 시작할 때만 `.env.example`을 `.env`로 복사하고 서버 주소를 입력한다.
실제 휴대전화에서는 PC의 `localhost`에 접근할 수 없다. PC LAN 주소 또는 팀 서버 주소를 사용한다.
`EXPO_PUBLIC_API_URL`은 공개 가능한 주소다. `EXPO_PUBLIC_` 변수에 비밀번호·서버 키·토큰을 넣지 않는다.
현재 화면은 API 주소를 사용하지 않으므로 환경 변수 없이 실행할 수 있다.

## Figma 1번 영역 미리보기

환영과 홈에서 습득물 검색을 열 수 있고, 홈의 예시 물품을 누르면 해당 상세로 이동한다.
홈의 내 근처 습득물 카드와 근처 탭에서 예시 지도를 열 수 있다. 반환 버튼은 미연동 상태다.
로그인 버튼(환영, 헤더, 내것·신고 안내)은 2번 영역 화면으로 이어진다.
환경 변수 없이도 개발 서버에서 환영 → 로그인(모의) → 내역 순서로 회원 화면을 볼 수 있다.
예시 물품 목록까지 보려면 개발 서버 실행 전에 다음과 같이 설정한다. 실제 로그인은 수행하지 않는다.

```powershell
$env:EXPO_PUBLIC_MISSU_PREVIEW = 'guest' # 비회원 홈과 Figma 예시 물품
npm start
```

회원 홈·내역·프로필·등록 물품은 서버를 종료한 후 `member`로 바꾸고 다시 실행한다.

```powershell
$env:EXPO_PUBLIC_MISSU_PREVIEW = 'member'
npm start
```

웹 보조 확인은 `npm run web`으로 실행하고 `/welcome`, `/home`, `/history`, `/report`,
`/registered-item`에 접근한다. 환영 화면은 미리보기 모드에서도 `/welcome`으로 확인한다.
기본 환영 화면으로 돌아가려면 해당 환경 변수를 비우고 서버를 다시 실행한다.

- 예시 이름·이메일·내역·거리·개수는 Figma의 **모의 데이터**다. 실제 조회 결과가 아니다.
- 프로필 저장은 실행 중 메모리에서만 반영되며 재실행하면 초기화된다.
- 로그아웃은 회원 미리보기 상태만 해제하고 비회원 홈으로 이동한다.
- 프로덕션 번들에서는 `__DEV__` 조건으로 미리보기와 예시 데이터를 표시하지 않는다.
- 미리보기 해제 상태의 홈은 아직 API가 없으므로 목록·거리·개수를 표시하지 않는다.

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
