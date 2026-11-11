import { router, useLocalSearchParams } from 'expo-router';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { foundItemStatus } from '@/lib/activity/transitions';
import { foundItemStatusLabel } from '@/lib/activity/types';
import { formatDate } from '@/lib/dateTime';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { primaryRequest, receivedRequests, receivedStatusLabel } from './activitySummary';

// Figma 01.07 (pending request), 01.07-E (none), 01.07-L (two or more pending).
// The 01.07-A/-D/-C states and the 08-B review screens follow in the holder stage.
export function RegisteredItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const activity = useActivity();
  const item = activity.foundItems.find((i) => i.id === id);
  const back = () => goBack('/history');

  if (!item)
    return (
      <FlowScreen
        title="내 등록 물품"
        onBack={back}
        heading="물품을 찾을 수 없어요"
        description="삭제되었거나 올바르지 않은 물품 주소예요."
        actions={<ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />}
      />
    );

  const requests = receivedRequests(activity).filter((r) => r.itemId === item.id);
  const pending = requests.filter((r) => r.status === 'pending');
  const main = primaryRequest(requests);
  const status = foundItemStatus(item, activity.requests);

  // The edit route prefills the registration draft from this item (FoundItemEditScreen).
  const edit = () => router.push({ pathname: '/my-items/[id]/edit', params: { id: item.id } });

  const requestCard = main ? (
    <Card title={`받은 주인 확인 요청 · ${requests.length}건`} blue>
      {pending.length > 1
        ? '요청자를 선택해 확인해 주세요.'
        : `${main.requesterName} · ${receivedStatusLabel[main.status]}\n물품 특징과 분실 시점·장소를 확인해 주세요.`}
    </Card>
  ) : (
    <Card title="받은 주인 확인 요청 · 0건" blue>
      {'아직 받은 요청이 없어요.\n요청이 도착하면 여기에서 확인할 수 있어요.'}
    </Card>
  );

  return (
    <FlowScreen
      title="내 등록 물품"
      onBack={back}
      heading={item.name}
      actions={
        main ? (
          <ActionButton label="받은 요청 확인" />
        ) : (
          <ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />
        )
      }
    >
      <Card title={foundItemStatusLabel[status]}>
        {`${item.storage}\n습득일: ${formatDate(item.foundAt)} · 사진 ${item.photos}장`}
      </Card>
      {requestCard}
      <ActionButton label="등록 정보 수정" variant="outline" onPress={edit} />
      {pending.length > 1 &&
        pending.map((request) => (
          <Card key={request.id} title={`${request.requesterName} · 확인 대기`}>
            요청 내용 확인
          </Card>
        ))}
    </FlowScreen>
  );
}
