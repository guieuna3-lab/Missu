# 가벼운 협업 규칙

## 작업 순서

이슈 작성 → main 최신화 → 작업 브랜치 생성 → 구현·확인 → PR → 팀원 리뷰 후 병합.

- 브랜치: `feat/12-login`, `fix/18-keyboard`, `chore/frontend-setup`처럼 목적을 짧게 작성한다. 번호는 이슈가 있을 때만 넣는다.
- 커밋: `feat: 로그인 화면 추가`, `fix: 입력창 키보드 가림 수정`, `chore: 초기 개발 설정`처럼 쓴다.
- 하나의 PR에는 한 가지 목적을 담는다. 관련 없는 파일은 커밋하지 않는다.
- 최소 한 명이 변경 내용을 읽고 확인한다. 자동 검사가 실패하면 원인을 해결한 뒤 병합한다.
- main에서 직접 기능 개발하지 않는다. 브랜치 보호를 강제하려면 GitHub 설정에서 별도로 지정해야 한다. 이 문서만으로 강제되지 않는다.

## 예시 명령 (저장소 루트)

```sh
git switch main
git pull origin main
git switch -c chore/frontend-setup
git status
```

작업 후 필요한 파일만 `git add`하고 커밋한다. `git push -u origin chore/frontend-setup` 후 GitHub에서 PR을 만든다.

이슈 템플릿은 기본 브랜치에 반영된 뒤 새 이슈 화면에서 확인한다. PR 템플릿도 main에 반영한 후 새 PR에서 확인한다. 템플릿은 FE·BE 공용이다.
