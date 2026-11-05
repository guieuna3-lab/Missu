import { router } from 'expo-router';
import { ActionButton } from '@/components/ActionButton';
import { AuthScreen } from './AuthScreen';
import { PrivacySummary } from './PrivacySummary';

// Figma 02-A.04. Both buttons go back to the previous screen (Figma BACK).
export function PrivacyNoticeScreen() {
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  return (
    <AuthScreen
      title="개인정보 수집 안내"
      onBack={close}
      heading="필요한 정보만 수집합니다"
      actions={<ActionButton label="돌아가기" onPress={close} />}
    >
      <PrivacySummary />
    </AuthScreen>
  );
}
