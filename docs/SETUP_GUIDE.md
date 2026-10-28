# 초기 설정 적용 가이드

## 1. 기존 저장소에 반영

이 ZIP은 첨부한 저장소를 바탕으로 작성했다. GitHub에 자동으로 반영되지는 않는다.

1. 기존에 클론한 저장소에서 `git status`로 개인 변경을 확인하고 보존한다.
2. main을 최신화하고 `git switch -c chore/frontend-setup`으로 작업 브랜치를 만든다.
3. ZIP을 별도 위치에 풀고 `Missu-main` **안의 내용**을 기존 저장소 루트에 복사한다. 저장소 안에 `Missu-main` 폴더를 한 단계 더 만들지 않는다.
4. `.github`, `.editorconfig` 등 점으로 시작하는 파일도 복사한다. 기존 `.git` 폴더는 유지한다. 이 ZIP에는 `.git`과 `node_modules`가 없다.
5. 이미 코드를 추가했다면 통째로 덮어쓰지 말고 변경 파일을 비교한다. 백엔드 README와 기존 루트 `.gitignore`는 유지했다.
6. 프론트 폴더에서 `npm ci`, `npm run check`, `npm start`를 실행한다.
7. 루트에서 `git diff`와 `git status`를 확인하고 필요한 파일만 선택해 커밋·푸시한 뒤 PR을 만든다.

```powershell
# 저장소 루트에서 시작
cd MissU_Frontend
npm ci
npm run check
npm start
# 개발 서버는 Ctrl+C로 종료
```

다른 터미널에서 또는 서버 종료 후:

```powershell
cd ..
git status
git add .github AGENTS.md .editorconfig README.md docs MissU_Frontend
git diff --cached --stat
git commit -m "chore: 프론트 초기 설정 및 협업 지침 추가"
git push -u origin chore/frontend-setup
```

위 명령은 작업 브랜치에 있다는 전제다. 커밋 전 `.env`, 개인정보, 불필요한 생성 파일이 포함되지 않았는지 확인한다.

## 2. 무엇을 어떻게 바꿨나

| 변경 | 방법 | 결과 |
| --- | --- | --- |
| 이슈 양식 | 기능·개선 / 버그 두 종류의 짧은 Markdown 템플릿 | 필요한 정보만 적고 작업 시작 |
| PR 양식 | 변경 내용·확인·관련 이슈 세 항목 | 리뷰어가 목적과 검증 결과를 빠르게 확인 |
| 프론트 지침 | `MissU_Frontend/AGENTS.md`에 모바일 UI·API·미슈 상태 흐름·검증 규칙 명시 | 에이전트가 웹 코드를 섞거나 미확인 연동을 완료로 보고하는 문제 감소 |
| 공통 지침 | 루트 `AGENTS.md`에서 범위와 공통 규칙 지정 | 프론트 작업이 백엔드를 불필요하게 변경하는 상황 방지 |
| 작업 프롬프트 | 기능·버그·리뷰·기기 확인 양식 | 요구 범위와 완료 기준을 매번 명확히 전달 |
| 앱 기반 | 공식 Expo 템플릿의 버전 조합을 사용하고 예제 UI·불필요한 의존성 정리 | 최소 시작 화면에서 기능 개발 시작 |
| 코드 품질 | TypeScript strict·Expo ESLint·Prettier·별칭 | 타입 오류와 포맷 차이를 일찍 발견 |
| 재현 설치 | npm 잠금 파일을 커밋 | 팀과 CI에서 동일한 의존성 설치 |
| CI | 프론트 변경 PR과 main 반영 시 `npm ci`·`npm run check` | 병합 전 타입·린트·포맷 문제 표시 |

## 3. 자동으로 되지 않는 것

- AGENTS.md는 규칙을 전달하는 문서다. 모든 에이전트가 자동으로 읽는 것은 아니므로 프롬프트에서 읽도록 명시한다.
- GitHub Actions는 업로드 후 실제 실행 결과를 확인해야 한다. 계정의 Actions 사용 정책·실행 한도에 영향을 받을 수 있다.
- 리뷰 규칙과 CI 실패 시 병합 금지를 강제하려면 GitHub의 브랜치 규칙을 별도로 설정해야 한다. 이 ZIP은 계정 설정을 바꾸지 않는다.
- 실제 기기 실행, 앱스토어 배포, 백엔드·인증·지도 연동은 별도 작업이다.
- 지도·사진·보안 저장소 등 네이티브 기능은 Expo Go 지원 여부를 확인한 후 선택한다.

## 4. 권장 첫 작업

설정을 PR로 반영한 뒤 팀원 전원이 `npm ci`와 첫 화면 실행을 확인한다.
이후 Figma에서 한 화면을 정하고 `FRONTEND_PROMPTS.md`의 기능 구현 양식으로 작업을 요청한다.

## 5. 작성 환경에서 확인한 결과 (2026-10-28)

- 의존성 설치와 잠금 파일 생성 완료. 잠금 파일을 사용하는 `npm ci --offline` 재현 설치도 통과.
- `npm run check`: 타입·린트·포맷 검사 통과.
- `CI=1 npx expo export --platform all`: Android·iOS JavaScript/Hermes 번들과 Web 정적 출력 생성 성공.
- 온라인 `npx expo install --check`: 의존성 호환성 검사 통과 (`Dependencies are up to date`).
- 기존 백엔드 README·루트 `.gitignore` 보존, 문서 링크·워크플로 YAML·잠금 파일 메타데이터 확인.
- 실제 iPhone·Android 화면, 네이티브 설치 파일 빌드, GitHub Actions 실행, 실제 API 연동은 확인하지 않음.

번들 생성은 실행에 필요한 코드를 묶는 검사이며 앱 설치·실기기 동작을 증명하지 않는다.
