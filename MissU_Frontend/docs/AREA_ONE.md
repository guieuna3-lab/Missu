# Figma 1번 영역 구현 기록

기준: 2026-11-02, [MissU Figma](https://www.figma.com/design/Fg3A56JQuGDVvWROpvUdEx/MissU?node-id=105-677).
디자인 컨텍스트, 각 화면 스크린샷과 실제 `reactions`를 읽었다. Figma는 수정하지 않았다.

## 화면과 구성

| Figma                            | 경로/구현                                  | 주요 동작                                  |
| -------------------------------- | ------------------------------------------ | ------------------------------------------ |
| 01.01 환영 `22:1891`             | `/`, `/welcome`, `WelcomeScreen`           | 원본 일러스트와 안내, 범위 밖 CTA 비활성   |
| 01.02 비회원 홈 `4:96`           | `/home`, `HomeScreen`                      | 홈·신고 안내·내것 안내 탭 이동             |
| 01.03 회원 홈 `22:2430`          | `/home`, 회원 미리보기                     | 이름 버튼 또는 내것 탭 → 내역              |
| 01.04 내것 로그인 안내 `4:1041`  | `/history`, `LoginGateScreen`              | 비회원용 안내와 하단 탭                    |
| 01.05 회원 내역 `4:1091`         | `/history`, `HistoryScreen`                | 프로필 모달, 등록 물품 이동, 모의 로그아웃 |
| 01.06 신고 로그인 안내 `22:1918` | `/report`, `LoginGateScreen`               | 비회원용 안내와 하단 탭                    |
| 01.07 내 등록 물품 `22:1814`     | `/registered-item`, `RegisteredItemScreen` | 보관·요청 정보, 뒤로 → 내역                |
| 01.05-A 프로필 수정 `118:1252`   | `ProfileModal`                             | 이름·이메일 입력, 메모리 저장 후 닫기      |

`src/components/`의 `Screen`은 Safe Area와 최대 본문 폭, `Header`는 로고·계정·뒤로,
`BottomNavigation`은 상태별 탭, `ActionButton`/`ActionBar`는 CTA, `Card`는 안내·활동,
`Icon`은 로컬 원본 아이콘을 담당한다. `src/constants/theme.ts`에는 Figma 색상과 서체 규격을 둔다.
`src/lib/preview/PreviewProvider`는 개발용 프로필 상태를 공유하며 인증을 대신하지 않는다.
`src/lib/preview/fixtures.ts`의 예시는 API와 분리했다.

## 확인한 프로토타입 흐름과 범위 경계

- 환영의 첫 CTA는 홈이 아니라 **03.01 검색**으로 이동한다. 로그인 CTA는
  `prototype/loginReturnTo=home`을 설정하고 02.01로 이동한다.
- 홈의 검색은 03.01, 근처 카드·탭은 **10.01 지도**, 물품 행은 각 비회원/회원 상세로 이동한다.
- `prototype/authenticated`에 따라 홈과 내것 탭의 목적지가 달라진다.
  신고 탭은 비회원이면 01.06, 회원이면 범위 밖 04.01이다.
- 내것/신고 안내의 계속하기는 각각 `loginReturnTo=mine/report`를 설정하고 로그인으로 이동한다.
- 내역의 정보 수정은 중앙 오버레이를 연다. Figma는 배경 음영 없음, 배경 클릭 닫기 없음이며
  저장 버튼은 `CLOSE`만 수행한다. 구현도 음영 없이 열고 배경 터치로 닫히지 않는다.
  실제 입력 가능성을 위해 미리보기 메모리의 이름·이메일을 갱신한다. 서버 저장·검증 정책은 미정이다.
- 내 분실 신고 → 04.02, 내가 등록한 습득물 → 01.07, 등록 정보 수정 → 05.02.
- **현재 Figma 연결 주의:** 내 반환 요청은 `prototype/returnCompleted`가 참이면 08.05,
  거짓이면 08-A.00(승인 거절)로 이동한다. 받은 요청 확인은 참이면 08-B.04,
  거짓이면 08-B.03(전달 완료·수령 확인 대기)으로 이동한다. 화면의 “확인 대기” 문구와
  이 연결이 일치하지 않을 수 있으므로 후속 반환 구현 전 설계 확인이 필요하다. 임의로 고치지 않았다.
- 로그아웃은 비회원 홈으로 이동한다. 구현은 모의 상태만 해제한다.
- 전환은 Figma의 dissolve/ease-out 150ms를 참고해 네이티브 스택 fade 150ms를 설정했다.
  RN Modal의 fade는 OS 기본 전환 시간이며 웹/OS별 전환은 완전히 동일하지 않을 수 있다.

사용자가 선택한 **“범위 밖 연결 비활성 + 개발용 회원 미리보기”**를 적용했다.
비활성 요소는 Figma의 색을 유지하되 실제 disabled와 접근성 상태/안내를 부여한다.
별도 로그인 화면, 검색/지도 화면, 가짜 API, 임의의 성공 알림은 추가하지 않았다.

## 디자인과 구현의 차이

- Figma 기준 폭 390, 좌우 20(환영 24), 버튼 52, Noto Sans KR/Outfit과 원본 자산 사용.
  고정 높이 844 대신 가변 높이·스크롤을 적용하고 큰 화면에서 본문 폭을 600으로 제한한다.
- 상태 표시줄의 9:41·통신·배터리 및 홈 제스처 막대는 앱 이미지가 아닌 OS가 표시한다.
  웹에는 해당 OS 영역이 없으므로 디자인과 총 높이·좌표가 다르다.
- 작은 화면에서 칩은 줄바꿈한다. 입력 모달은 키보드 회피와 스크롤을 제공한다.
- 프로필 모달은 Figma의 필드 고정 높이가 내부 요소 합보다 4px 작은 부분을 자연 높이로
  처리하여 겹치지 않게 했다. OS 뒤로/웹 Escape 닫기는 접근성을 위해 지원한다.
- 환영에서 홈으로 가는 가짜 연결을 만들지 않았다. 미리보기 진입은 개발 설정으로만 제공한다.
- 폰트 로딩 중 표시와 실패 안내는 런타임 처리이며 Figma에는 정의되지 않았다.

## 남은 연동과 검증

백엔드 폴더에는 README만 있고 API 구현·계약이 없다. 인증/세션, 최근 물품과 주변 거리,
개인 활동·받은 요청 조회, 프로필 저장·검증, 실제 로그아웃은 모두 미연동이다.
서버 오류·로딩·재시도·빈 결과 디자인 및 입력 검증/오류 문구도 확정된 것으로 간주하지 않는다.

- `npm run check`: 타입·린트·포맷 통과(Windows, Node 22.13.0).
- `npx expo export --platform all --output-dir dist/area-one`: Android/iOS Hermes 번들 및 웹 정적 경로 8개 생성 성공.
  첫 시도는 샌드박스의 Hermes 실행 권한 오류로 실패했으며 권한 확장 재실행은 통과했다.
  네이티브 앱 설치·실행 검증을 의미하지 않는다.
- `npx expo install --check`: 온라인 검사는 기존 패키지 6개의 패치 버전 차이로 실패했다.
  현재→권장: Expo 58.0.20→58.0.22, constants 58.0.13→58.0.14,
  linking 58.0.14→58.0.15, router 58.0.27→58.0.29,
  React Native 0.88.0→0.88.1, screens 4.30.0→4.30.1.
  이번 추가 패키지 image/font는 지적되지 않았다. 범위 밖 일괄 업데이트는 하지 않았다.
- 원본 자산 17개가 로컬에 존재하고 비어 있지 않음, SVG 루트 규격 14/20/24px와 호출 크기 일치 확인.
- **시각·동작 검증 미완료:** 브라우저 접근 호스트 불가 후 Windows 컴퓨터 사용 도구도
  현재 URL을 확인하지 못해 조작을 차단했다. 렌더링 캡처·실제 클릭 성공을 주장하지 않는다.
  Android/iPhone 실기기, 작은 화면, 키보드, OS 뒤로, SVG·가변 폰트 네이티브 렌더링 확인이 남아 있다.

## 로컬 확인 순서

설치/실행 명령과 미리보기 환경 변수는 [README](../README.md#figma-1번-영역-미리보기)를 참고한다.

1. 환경 변수 없이 시작하여 환영 화면, 본문 스크롤과 비활성 CTA 확인.
2. `guest` 모드: 홈 → 내것 로그인 안내 → 신고 로그인 안내 → 홈.
3. `member` 모드: 홈 이름 버튼 → 내역 → 정보 수정 → 두 입력 변경 → 저장 → 헤더/프로필 갱신.
4. 내역 → 내가 등록한 습득물 → 뒤로 → 내역. 범위 밖 등록 수정/받은 요청은 비활성.
5. 로그아웃 → 비회원 홈 → 내것 로그인 안내. `/registered-item` 직접 접근도 안내로 이동.
6. 320px/390px/큰 화면, 긴 이름·이메일, 키보드 표시, 재실행 시 모의 상태 초기화 확인.
7. 배포 번들에서는 `member` 환경 변수만으로 회원 화면이 열리지 않는지 확인.

## 변경 파일

- 수정: `src/app/index.tsx`, `_layout.tsx`, `package.json`, `package-lock.json`, `app.json`,
  `.env.example`, `README.md`.
- 추가: `src/app/{welcome,home,history,report,registered-item}.tsx`, `src/features/area-one/*`,
  `assets/area-one/*`, `assets/fonts/*`, 이 문서.
- 2026-11-03 구조 정리: `src/features/area-one/*`를 `src/features/{welcome,home,history,auth}`,
  `src/components/`, `src/constants/`, `src/lib/preview/`로 나누고 `assets/area-one/*`를
  `assets/icons/`, `assets/images/`로 옮겼다. 화면 동작 변경 없음.
- `expo-image`: 원본 이미지/SVG 표시. `expo-font`: 로컬 지정 서체 로딩. Expo SDK 58 호환 버전 사용.
- 백엔드·공통 CI 변경 없음. 커밋·PR 병합·배포 없음.

폰트는 [Google Fonts Noto Sans KR](https://github.com/google/fonts/tree/main/ofl/notosanskr) 및
[Outfit](https://github.com/google/fonts/tree/main/ofl/outfit)의 OFL 배포본이며 라이선스를 함께 포함했다.
일러스트/아이콘은 제공된 Figma 파일에서 받은 원본이다. 임시 Figma 자산 URL을 런타임에서 사용하지 않는다.
