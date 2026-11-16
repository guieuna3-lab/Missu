# 아이폰에서 미슈 이동 경로 기록하기

미슈 iOS 앱은 로그인한 사용자가 **근처 → 내 하루 이동 경로 → 위치 기록 시작**을 누른 뒤에만 위치를 기록합니다. 화면에 표시된 48시간 보관에 동의하고, 아이폰에서 미슈의 위치 접근을 **항상**, **정확한 위치**를 **켬**으로 설정합니다. 이동 중 화면을 잠그거나 다른 앱을 열 수 있습니다. 기록을 끝내려면 미슈로 돌아와 **위치 기록 중지**를 누릅니다. 사용자가 앱을 강제 종료하면 iOS가 위치 전달을 중단할 수 있습니다.

## Mac과 테스트용 아이폰으로 확인하기

1. Mac에 이 Expo SDK를 지원하는 Xcode와 CocoaPods를 설치하고 Xcode에 Apple 계정을 추가합니다. 아이폰을 연결하고 요청에 따라 신뢰 및 개발자 모드를 설정합니다.
2. 팀 저장소의 `MissU_Frontend` 폴더 또는 소스 ZIP을 푼 폴더에서 `npm ci`를 실행합니다. Node 버전은 `package.json`의 `engines`를 따릅니다.
3. 이 폴더에 `.env.local`을 만들고 아래 두 줄을 저장합니다.

   ```dotenv
   EXPO_PUBLIC_API_URL=https://missu-api-wkdu.onrender.com/api/v1
   EXPO_PUBLIC_POLICY_VERSION=v1.0
   ```

4. `npx expo prebuild --platform ios`를 실행합니다. 생성된 `ios` 폴더에서 Xcode 워크스페이스를 열고 앱 대상의 **Signing & Capabilities → Team**에서 사용할 팀을 선택합니다. 기본 번들 ID는 `kr.missu.app`입니다. Apple에서 이 ID를 해당 팀에 등록할 수 없다면 `app.json`의 `ios.bundleIdentifier`를 팀이 사용할 ID로 바꾸고 다시 생성합니다.
5. 프론트 폴더에서 `npx expo run:ios --device --configuration Release`를 실행해 아이폰에 설치합니다. Release 빌드는 노트북의 개발 서버 없이 운영 API에 접속합니다.

## 실기기에서 확인할 순서

1. 한 계정으로 로그인해 기록을 시작하고 첫 위치가 저장되는지 확인합니다.
2. 화면을 잠그고 이동한 뒤 다른 앱을 열고 더 이동합니다. 미슈로 돌아와 기록 시작 이후의 지점이 시간순으로 보이는지 확인합니다. GPS 신호와 이동 거리에 따라 지점 간격은 달라집니다.
3. 기록을 중지하고 한 번 더 이동합니다. 같은 기록에 새 지점이 추가되지 않는지 확인합니다. 경로는 한 번에 최대 24시간 기록하며 서버는 각 지점을 측정 시각부터 48시간 보관합니다.

## 팀에 TestFlight로 배포하기

Apple Developer Program 팀과 App Store Connect 권한을 준비한 뒤 Expo 계정으로 `npx eas-cli login`과 최초 1회 `npx eas-cli init`을 실행합니다. `npx eas-cli build --platform ios --profile production`으로 서명된 앱을 만들고, `npx eas-cli submit --platform ios --latest`로 업로드합니다. App Store Connect의 TestFlight에서 처리 결과를 확인한 후 테스터를 초대합니다.

Safari와 홈 화면에 추가한 웹 아이콘에서는 해당 경로 화면이 열린 동안만 기록합니다. TestFlight 앱 또는 서명해 설치한 앱에서 백그라운드 기록을 시험하세요.

