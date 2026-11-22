# MissU 앱 아이콘

![기존 형태와 Android 원형·둥근 사각형 아이콘 미리보기](./preview.png)

- 원본 [Figma 앱 아이콘](https://www.figma.com/design/Fg3A56JQuGDVvWROpvUdEx/MissU?node-id=368-3340)은 `missu-figma.png`에 1024×1024 PNG로 보관합니다.
- 같은 그룹의 `MissU.` 텍스트 레이어 `368:3339` 영역을 원본 PNG에서 추출해 `missu-wordmark.png`로 생성합니다. 흰 바탕만 투명하게 처리하며 글꼴을 다시 그리거나 로고·색상·비율을 변경하지 않습니다.
- Windows PowerShell에서 `android-launcher/scripts/generate-icons.ps1`을 실행하면 Android 6·7용 밀도별 아이콘과 Android 8 이상용 투명 전경을 다시 만듭니다.
- 적응형 아이콘은 흰색 배경과 로고 전경을 분리합니다. 108dp 레이어의 중앙 72dp에 원본 아이콘의 로고 배치를 유지하며 외곽 모양은 기기 런처의 마스크를 따릅니다.
- 실제 배포 APK는 `android-launcher/src/main/AndroidManifest.xml`의 `@mipmap/ic_launcher`를 사용합니다. Expo Android 빌드에도 같은 원본과 전경을 연결했습니다.

아이콘 변경은 웹 배포만으로 설치된 APK에 반영되지 않습니다. 설치 페이지의 1.2.1 APK를 기존 앱 위에 업데이트합니다. 기존 서명 키를 사용하며 Android 패키지와 데이터는 유지합니다.

아이폰 홈 화면 웹과 웹 푸시는 같은 원본의 흰 배경 아이콘을 사용합니다.
`android-launcher/scripts/generate-web-icons.ps1`은 180·192·512px 웹 아이콘과 1024px iOS 아이콘을 생성합니다.
버전이 붙은 파일 경로로 기존 이미지 캐시와 구분하며, manifest의 앱 ID·시작 주소는 유지합니다.
이미 추가된 아이콘이 바뀌지 않으면 Safari에서 홈 화면에 다시 추가하고 로그인·알림 권한을 확인합니다.
