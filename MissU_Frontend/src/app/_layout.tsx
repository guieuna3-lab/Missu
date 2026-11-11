import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { ActivityIndicator, Text, View } from 'react-native';
import { SignupDraftProvider } from '@/features/auth/SignupDraft';
import { ReportDraftProvider } from '@/features/report/ReportDraft';
import { ActivityProvider } from '@/lib/activity/ActivityProvider';
import { PreviewProvider } from '@/lib/preview/PreviewProvider';

export default function RootLayout() {
  const [loaded, error] = useFonts([
    {
      fontFamily: 'NotoSansKR',
      fontDefinitions: [{ path: require('../../assets/fonts/NotoSansKR.ttf'), weight: '100 900' }],
    },
    {
      fontFamily: 'Outfit',
      fontDefinitions: [{ path: require('../../assets/fonts/Outfit.ttf'), weight: '100 900' }],
    },
  ]);
  if (!loaded)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {error ? (
          <Text>글꼴을 불러오지 못했습니다. 앱을 다시 실행해 주세요.</Text>
        ) : (
          <ActivityIndicator accessibilityLabel="화면 준비 중" />
        )}
      </View>
    );
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <PreviewProvider>
        <ActivityProvider>
          <SignupDraftProvider>
            <ReportDraftProvider>
              <Stack
                screenOptions={{ headerShown: false, animation: 'fade', animationDuration: 150 }}
              />
            </ReportDraftProvider>
          </SignupDraftProvider>
        </ActivityProvider>
      </PreviewProvider>
    </SafeAreaProvider>
  );
}
