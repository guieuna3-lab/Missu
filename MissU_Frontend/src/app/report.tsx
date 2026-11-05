import { Redirect } from 'expo-router';
import { LoginGateScreen } from '@/features/auth/LoginGateScreen';
import { usePreview } from '@/lib/preview/PreviewProvider';

export default function Report() {
  const { profile } = usePreview();
  return profile ? <Redirect href="/home" /> : <LoginGateScreen kind="report" />;
}
