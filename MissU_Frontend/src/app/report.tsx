import { LoginGateScreen } from '@/features/auth/LoginGateScreen';
import { ReportTypeScreen } from '@/features/report/ReportTypeScreen';
import { usePreview } from '@/lib/preview/PreviewProvider';

// 신고 tab: Figma 04.01 for members, 01.06 for guests.
export default function Report() {
  const { profile } = usePreview();
  return profile ? <ReportTypeScreen /> : <LoginGateScreen kind="report" />;
}
