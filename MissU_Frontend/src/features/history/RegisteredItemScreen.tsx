import { router, useLocalSearchParams } from 'expo-router';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { ChoiceRow } from '@/components/ChoiceRow';
import { FlowScreen } from '@/components/FlowScreen';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { foundItemStatus } from '@/lib/activity/transitions';
import { foundItemStatusLabel, type OwnershipRequest } from '@/lib/activity/types';
import { formatDate } from '@/lib/dateTime';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { primaryRequest, receivedRequests, receivedStatusLabel } from './activitySummary';

// Figma 01.07 and its states: -E (no request), -L (two or more pending), -A (approved,
// return in progress), -D (handed over) and -C (returned). Each opens the 08-B screens.
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
  const openRequest = (request: OwnershipRequest) =>
    router.push({
      pathname: '/my-items/[id]/requests/[requestId]',
      params: { id: item.id, requestId: request.id },
    });
  // The edit route prefills the registration draft from this item (FoundItemEditScreen).
  const edit = () => router.push({ pathname: '/my-items/[id]/edit', params: { id: item.id } });

  const summary = (() => {
    if (!main)
      return {
        title: '받은 주인 확인 요청 · 0건',
        body: '아직 받은 요청이 없어요.\n요청이 도착하면 여기에서 확인할 수 있어요.',
        action: undefined,
      };
    switch (main.status) {
      case 'approved':
      case 'scheduled':
        return {
          title: '승인 후 반환 진행 중',
          body: `${main.requesterName} · 주인 확인 승인\n반환 일정을 정하고 물품을 전달해 주세요.`,
          action: '반환 진행 보기',
        };
      case 'handed':
        return {
          title: '전달 완료 · 수령 확인 대기',
          body: `${main.requesterName} · 전달 완료\n요청자가 수령을 확인하면 반환이 완료돼요.`,
          action: '전달 상태 보기',
        };
      case 'completed':
        return {
          title: '반환 완료',
          body: `${main.requesterName} · 수령 확인 완료${
            main.appointment ? `\n${main.appointment.date} · ${main.appointment.time}` : ''
          }`,
          action: '반환 완료 보기',
        };
      case 'rejected':
        return {
          title: `받은 주인 확인 요청 · ${requests.length}건`,
          body: `${main.requesterName} · ${receivedStatusLabel.rejected}`,
          action: undefined,
        };
      default:
        return {
          title: `받은 주인 확인 요청 · ${requests.length}건`,
          body:
            pending.length > 1
              ? '요청자를 선택해 확인해 주세요.'
              : `${main.requesterName} · 확인 대기\n물품 특징과 분실 시점·장소를 확인해 주세요.`,
          action: '받은 요청 확인',
        };
    }
  })();

  return (
    <FlowScreen
      title="내 등록 물품"
      onBack={back}
      heading={item.name}
      actions={
        summary.action && main ? (
          <ActionButton label={summary.action} onPress={() => openRequest(main)} />
        ) : (
          <ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />
        )
      }
    >
      <Card title={foundItemStatusLabel[status]}>
        {`${item.storage}\n습득일: ${formatDate(item.foundAt)} · 사진 ${item.photos}장`}
      </Card>
      <Card title={summary.title} blue>
        {summary.body}
      </Card>
      <ActionButton label="등록 정보 수정" variant="outline" onPress={edit} />
      {pending.length > 1 &&
        pending.map((request) => (
          <ChoiceRow
            key={request.id}
            icon="user"
            title={`${request.requesterName} · 확인 대기`}
            description="요청 내용 확인"
            onPress={() => openRequest(request)}
          />
        ))}
    </FlowScreen>
  );
}
