import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { FlowScreen } from '@/components/FlowScreen';
import { FormMessage, TextLink } from '@/components/FormField';
import { colors } from '@/constants/theme';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { categoryLabel } from '@/lib/activity/types';
import { formatDate, formatDateTimeRange, formatTime } from '@/lib/dateTime';
import { requestErrorMessage } from '@/lib/mockRequest';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { ReportMatches } from '@/features/report/ReportMatches';
import { useReportDraft } from '@/features/report/ReportDraft';

// Figma 01.08 and the 01.08-C delete confirmation.
export function LostReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lostReports, deleteLostReport, status, reportsError, retryReports } = useActivity();
  const { resetLost } = useReportDraft();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const report = lostReports.find((r) => r.id === id);
  const back = () => goBack('/history');

  if (!report && (status === 'loading' || reportsError))
    return (
      <FlowScreen
        title="내 분실 신고"
        onBack={back}
        heading={reportsError || '신고를 불러오고 있어요'}
        actions={reportsError && <ActionButton label="다시 불러오기" onPress={retryReports} />}
      />
    );
  if (!report)
    return (
      <FlowScreen
        title="내 분실 신고"
        onBack={back}
        heading="신고를 찾을 수 없어요"
        description="삭제되었거나 올바르지 않은 신고 주소예요."
        actions={<ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />}
      />
    );

  function edit() {
    if (!report) return;
    resetLost({
      editingId: report.id,
      category: report.category,
      name: report.name,
      feature: report.feature,
      fromText: `${formatDate(report.lostFrom)} ${formatTime(report.lostFrom)}`,
      toText:
        report.lostTo === report.lostFrom
          ? ''
          : `${formatDate(report.lostTo)} ${formatTime(report.lostTo)}`,
      place: report.place,
    });
    router.push('/report/lost');
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setError(undefined);
    try {
      await deleteLostReport(report!.id);
      setConfirming(false);
      leaveFlowTo('/history');
    } catch (requestError) {
      setConfirming(false);
      setError(requestErrorMessage(requestError));
      setDeleting(false);
    }
  }

  return (
    <FlowScreen
      title="내 분실 신고"
      onBack={back}
      heading="내 분실 신고"
      actions={
        <ActionButton
          label="신고 수정"
          variant="outline"
          onPress={edit}
          style={styles.blueOutline}
        />
      }
    >
      <Card title={report.name}>{`${categoryLabel(report.category)} · 신고됨`}</Card>
      <Card title="물품 특징">{report.feature || '입력하지 않았어요'}</Card>
      <Card title="분실 시점">{formatDateTimeRange(report.lostFrom, report.lostTo)}</Card>
      <Card title="분실 장소">{report.place.detail}</Card>
      <ReportMatches key={report.id} id={report.id} />
      {error && <FormMessage>{error}</FormMessage>}
      <View style={styles.deleteRow}>
        <TextLink label="신고 삭제" onPress={() => setConfirming(true)} />
      </View>
      {confirming && (
        <ConfirmDialog
          title="신고를 삭제할까요?"
          message="삭제 후 내역으로 돌아갑니다."
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
          loading={deleting}
        />
      )}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  deleteRow: { minHeight: 44, justifyContent: 'center' },
  blueOutline: { borderColor: colors.blue },
});
