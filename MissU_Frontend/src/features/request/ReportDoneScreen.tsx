import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { api } from '@/lib/backend';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { goBack, leaveFlowTo } from '@/lib/navigation';

// Figma 08-A.02
export function ReportDoneScreen() {
  const { receiptId } = useLocalSearchParams<{ receiptId?: string }>();
  const { accessToken } = usePreview();
  type Receipt = { reason: string; description?: string; photoCount: number };
  const [result, setResult] = useState<{
    token: string;
    id: string;
    data?: Receipt;
    error?: boolean;
  }>();
  const matches = result && result.token === accessToken && result.id === receiptId;
  const receipt = matches ? result.data : undefined;
  const error = matches && result.error;
  useEffect(() => {
    let active = true;
    if (accessToken && receiptId)
      void api<{ data: { reason: string; description?: string; photoCount: number } }>(
        '/reports/' + encodeURIComponent(receiptId),
        { headers: { Authorization: 'Bearer ' + accessToken } },
      )
        .then((r) => {
          if (active) setResult({ token: accessToken, id: receiptId, data: r.data });
        })
        .catch(() => {
          if (active) setResult({ token: accessToken, id: receiptId, error: true });
        });
    return () => {
      active = false;
    };
  }, [accessToken, receiptId]);
  return (
    <FlowScreen
      title="의심 요청 · 접수 완료"
      onBack={() => goBack('/history')}
      centered
      heading={
        accessToken && !receipt
          ? error || !receiptId
            ? '접수 내역을 확인할 수 없어요'
            : '접수 내역 확인 중'
          : '신고를 접수했어요'
      }
      actions={<ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />}
    >
      {receipt && (
        <Card title={receipt.reason}>
          {[receipt.description, '첨부 사진 ' + receipt.photoCount + '장']
            .filter(Boolean)
            .join(' · ')}
        </Card>
      )}
      <Card title="거래를 잠시 중단해 주세요" blue centered accent>
        확인 전에는 돈을 보내거나 외부 링크에 정보를 입력하지 마세요.
      </Card>
    </FlowScreen>
  );
}
