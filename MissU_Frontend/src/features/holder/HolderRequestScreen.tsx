import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { FlowScreen } from '@/components/FlowScreen';
import { FormMessage, TextLink } from '@/components/FormField';
import { useActivity } from '@/lib/activity/ActivityProvider';
import type { FoundItem, OwnershipRequest } from '@/lib/activity/types';
import { requestErrorMessage } from '@/lib/mockRequest';
import { goBack, leaveFlowTo } from '@/lib/navigation';

// The holder's view of one request on a registered item (Figma 08-B), by status:
// pending → 08-B.01 review, approved/scheduled → 08-B.02 progress, handed → 08-B.03,
// completed → 08-B.04. The requester moves it from handed to completed.
export function HolderRequestScreen() {
  const { id = '', requestId = '' } = useLocalSearchParams<{ id: string; requestId: string }>();
  const { foundItems, requests } = useActivity();
  const item = foundItems.find((i) => i.id === id);
  const request = requests.find((r) => r.id === requestId && r.itemId === id);
  const backToItem = () => goBack({ pathname: '/my-items/[id]', params: { id } });

  if (!item || !request)
    return (
      <FlowScreen
        title="받은 주인 확인 요청"
        onBack={backToItem}
        heading="요청을 찾을 수 없어요"
        description="취소되었거나 올바르지 않은 요청 주소예요."
        actions={<ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />}
      />
    );

  switch (request.status) {
    case 'pending':
      return <ReviewScreen item={item} request={request} onBack={backToItem} />;
    case 'approved':
    case 'scheduled':
      return <ProgressScreen request={request} onBack={backToItem} />;
    case 'handed':
      return (
        <FlowScreen
          title="보관자 · 전달 상태"
          onBack={backToItem}
          centered
          heading="물품을 전달했어요"
          actions={<ActionButton label="내 등록 물품 보기" onPress={backToItem} />}
        >
          <Card title="요청자의 수령 확인 대기" blue centered>
            {'요청자가 물품을 받았다고 확인하면\n최종 반환 완료로 표시됩니다.'}
          </Card>
        </FlowScreen>
      );
    case 'completed':
      return (
        <FlowScreen
          title="보관자 · 반환 완료"
          onBack={backToItem}
          centered
          heading="물품 반환이 완료됐어요"
          actions={<ActionButton label="내 등록 물품 보기" onPress={backToItem} />}
        >
          <Card title={request.itemName} centered>
            {`요청자 수령 확인 완료\n${
              request.appointment
                ? `${request.appointment.date} · ${request.appointment.time}`
                : '수령 확인 시각은 서버 연동 후 표시됩니다.'
            }`}
          </Card>
        </FlowScreen>
      );
    case 'rejected':
      // Figma has no holder screen for a rejected request; this is a minimal placeholder.
      return (
        <FlowScreen
          title="받은 주인 확인 요청"
          onBack={backToItem}
          centered
          heading="거절한 요청이에요"
          description={
            request.closedReason ?? `${request.requesterName} 님의 요청은 정보 불일치로 거절했어요.`
          }
          actions={<ActionButton label="내 등록 물품 보기" onPress={backToItem} />}
        />
      );
  }
}

// Figma 08-B.01 with the 08-B.01-C reject confirmation.
function ReviewScreen({
  item,
  request,
  onBack,
}: {
  item: FoundItem;
  request: OwnershipRequest;
  onBack: () => void;
}) {
  const { approveRequest, rejectRequest } = useActivity();
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'reject'>();
  const [error, setError] = useState<string>();

  async function approve() {
    if (busy) return;
    setBusy('approve');
    setError(undefined);
    try {
      await approveRequest(request.id);
    } catch (caught) {
      setError(requestErrorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function reject() {
    if (busy) return;
    setBusy('reject');
    setError(undefined);
    try {
      await rejectRequest(request.id);
      setRejecting(false);
      // The holder returns to the item (Figma N1: the prototype wrongly opened 08-A.00).
      onBack();
    } catch (caught) {
      setRejecting(false);
      setError(requestErrorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <FlowScreen
      title="받은 주인 확인 요청"
      onBack={onBack}
      heading="물품 특징을 비교해 주세요"
      actions={
        <ActionButton label="주인 확인 승인" onPress={approve} loading={busy === 'approve'} />
      }
    >
      <Card title="등록한 비공개 특징">
        {item.privateFeature ||
          '등록한 비공개 특징이 없어요. 요청 내용을 바탕으로 실물을 확인해 주세요.'}
      </Card>
      <Card title="요청자가 작성한 정보">{`${request.feature}\n${request.lostInfo}`}</Card>
      <Card title="승인 전에 확인해 주세요" blue>
        {
          '공개 사진에 없는 특징을 대조해 주세요.\n등록한 특징이 없으면 요청 내용을 바탕으로\n실물을 확인한 뒤 전달해 주세요.'
        }
      </Card>
      <ActionButton
        label="정보 불일치 · 요청 거절"
        variant="outline"
        onPress={() => setRejecting(true)}
      />
      {error && <FormMessage>{error}</FormMessage>}
      <View style={styles.linkRow}>
        <TextLink
          label="의심 요청 신고"
          onPress={() =>
            router.push({
              pathname: '/requests/[id]/report',
              params: { id: request.id, role: 'holder' },
            })
          }
        />
      </View>
      {rejecting && (
        <ConfirmDialog
          title="요청을 거절할까요?"
          message="요청자에게 거절 결과가 전달됩니다."
          onCancel={() => setRejecting(false)}
          onConfirm={reject}
          loading={busy === 'reject'}
        />
      )}
    </FlowScreen>
  );
}

// Figma 08-B.02 with the 08-B.02-C hand-over confirmation.
function ProgressScreen({ request, onBack }: { request: OwnershipRequest; onBack: () => void }) {
  const { markHanded } = useActivity();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const appointment = request.appointment;

  async function handOver() {
    if (submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await markHanded(request.id);
      setConfirming(false);
    } catch (caught) {
      setConfirming(false);
      setError(requestErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FlowScreen
      title="보관자 · 반환 진행"
      onBack={onBack}
      heading="반환 일정을 정해 주세요"
      actions={<ActionButton label="물품을 전달했어요" onPress={() => setConfirming(true)} />}
    >
      <Card title={`${request.requesterName} · 주인 확인 승인`}>
        {appointment
          ? `${appointment.place}\n${appointment.date} · ${appointment.time}`
          : '반환 대화에서 약속 장소와 시간을 정해 주세요.'}
      </Card>
      <Card title="전달 후 상태" blue>
        {'물품을 전달하면 전달 완료로 표시합니다.\n요청자가 수령을 확인하면 최종 반환이 완료돼요.'}
      </Card>
      <ActionButton
        label="반환 대화 열기"
        variant="outline"
        onPress={() =>
          router.push({
            pathname: '/my-items/[id]/requests/[requestId]/chat',
            params: { id: request.itemId, requestId: request.id },
          })
        }
      />
      {error && <FormMessage>{error}</FormMessage>}
      {confirming && (
        <ConfirmDialog
          title="물품을 전달했나요?"
          message="전달 후 요청자의 수령 확인을 기다립니다."
          onCancel={() => setConfirming(false)}
          onConfirm={handOver}
          loading={submitting}
        />
      )}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  linkRow: { minHeight: 44, justifyContent: 'center' },
});
