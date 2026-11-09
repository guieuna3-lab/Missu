import { Redirect } from 'expo-router';
import { LoginGateScreen } from '@/features/auth/LoginGateScreen';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { apiBase } from '@/lib/backend';
import { FoundItemScreen } from '@/features/report/FoundItemScreen';

export default function Report() {
  const { profile, accessToken } = usePreview();
  if (apiBase)
    return accessToken ? (
      <FoundItemScreen key={accessToken} token={accessToken} />
    ) : (
      <LoginGateScreen kind="report" />
    );
  return profile ? <Redirect href="/home" /> : <LoginGateScreen kind="report" />;
}
