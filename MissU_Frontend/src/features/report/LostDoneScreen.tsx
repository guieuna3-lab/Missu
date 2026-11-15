import { router, useLocalSearchParams } from 'expo-router';
import { ReportMatches } from './ReportMatches';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { formatDateTimeRange } from '@/lib/dateTime';

// Figma 04.05
export function LostDoneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lostReports } = useActivity();
  const report = lostReports.find((r) => r.id === id);
  const backToReportTab = () => router.dismissTo('/report');
  return (
    <FlowScreen
      title="분실 신고 완료"
      onBack={backToReportTab}
      heading="분실 신고를 등록했어요"
      actions={
        <ActionButton
          label="내 신고 보기"
          onPress={() => {
            backToReportTab();
            router.push({ pathname: '/my-reports/[id]', params: { id } });
          }}
        />
      }
    >
      {report && (
        <Card title={report.name} centered>
          {`${report.place.detail} · ${formatDateTimeRange(report.lostFrom, report.lostTo)}`}
        </Card>
      )}
      <ReportMatches key={id} id={id} />
      <ActionButton
        label="습득물 검색하기"
        variant="outline"
        onPress={() => {
          backToReportTab();
          router.push('/search');
        }}
      />
    </FlowScreen>
  );
}
