import { Redirect } from 'expo-router';
import { WelcomeScreen } from '@/features/welcome/WelcomeScreen';
import { isPreview } from '@/lib/preview/PreviewProvider';

export default function Index() {
  return isPreview ? <Redirect href="/home" /> : <WelcomeScreen />;
}
