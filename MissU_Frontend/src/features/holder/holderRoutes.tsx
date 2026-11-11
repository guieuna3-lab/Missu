import { router, useLocalSearchParams } from 'expo-router';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { AppointmentProposalScreen } from '@/features/request/AppointmentProposalScreen';
import { ReturnChatScreen } from '@/features/request/ReturnChatScreen';

// Route entries under /my-items/[id]/requests/[requestId]: the holder's chat (08-B.02-A)
// and appointment proposal (08-B.02-B) reuse the requester components with role "holder".
function useHolderRequest() {
  const { id = '', requestId = '' } = useLocalSearchParams<{ id: string; requestId: string }>();
  const { requests } = useActivity();
  const request = requests.find((r) => r.id === requestId && r.itemId === id);
  const hub = {
    pathname: '/my-items/[id]/requests/[requestId]',
    params: { id, requestId },
  } as const;
  return { id, requestId, request, hub };
}

function MissingRequest({ onBack }: { onBack: () => void }) {
  return (
    <FlowScreen
      title="반환 대화"
      onBack={onBack}
      heading="요청을 찾을 수 없어요"
      actions={<ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />}
    />
  );
}

export function HolderChatRoute() {
  const { id, requestId, request, hub } = useHolderRequest();
  const back = () => goBack(hub);
  if (!request) return <MissingRequest onBack={back} />;
  return (
    <ReturnChatScreen
      request={request}
      role="holder"
      onBack={back}
      onPropose={() =>
        router.push({
          pathname: '/my-items/[id]/requests/[requestId]/propose',
          params: { id, requestId },
        })
      }
      onReport={() =>
        router.push({
          pathname: '/requests/[id]/report',
          params: { id: requestId, role: 'holder' },
        })
      }
    />
  );
}

export function HolderProposeRoute() {
  const { id, requestId, request, hub } = useHolderRequest();
  const back = () =>
    goBack({ pathname: '/my-items/[id]/requests/[requestId]/chat', params: { id, requestId } });
  if (!request) return <MissingRequest onBack={() => goBack(hub)} />;
  return (
    <AppointmentProposalScreen requestId={requestId} role="holder" onBack={back} onSent={back} />
  );
}
