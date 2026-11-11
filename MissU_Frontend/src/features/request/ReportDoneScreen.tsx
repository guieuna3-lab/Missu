import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { goBack, leaveFlowTo } from '@/lib/navigation';

// Figma 08-A.02
export function ReportDoneScreen() {
  return (
    <FlowScreen
      title="의심 요청 · 접수 완료"
      onBack={() => goBack('/history')}
      centered
      heading="신고를 접수했어요"
      actions={<ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />}
    >
      <Card title="거래를 잠시 중단해 주세요" blue centered accent>
        확인 전에는 돈을 보내거나 외부 링크에 정보를 입력하지 마세요.
      </Card>
    </FlowScreen>
  );
}
