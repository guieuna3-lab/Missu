# 미슈 안드로이드 설치 앱

홈 아이콘에서 팀의 운영 웹 `https://missu-web.onrender.com/`을 엽니다. 웹 화면을 수정하면 기존 Render 배포가 끝난 뒤 앱을 다시 열어 확인할 수 있습니다. 아이폰에서는 같은 주소를 Safari로 열고 공유 메뉴에서 **홈 화면에 추가**를 선택합니다.

## 안드로이드 APK 다시 만들기

JDK 17, Gradle 8.11.1, Android SDK 플랫폼 36과 Build Tools 35.0.0을 사용합니다. 이 폴더에서 `gradle assembleRelease`를 실행하면 `build/outputs/apk/release/`에 서명 전 APK가 생깁니다.

런처 자체를 바꿀 때는 `build.gradle`의 `versionCode`를 올리고, 기존 릴리스 서명 키로 APK에 서명합니다. 서명 후 `apksigner verify --verbose --print-certs`로 확인합니다. 설치된 앱을 덮어쓸 수 있도록 패키지명 `kr.missu.web`과 서명 키를 유지합니다.

웹과 앱의 연결 정보는 `../public/.well-known/assetlinks.json`에 있습니다. 여기에는 서명 인증서의 공개 SHA-256 지문만 들어갑니다. 서명 키와 비밀번호는 앱 저장소 밖에서 관리합니다.
