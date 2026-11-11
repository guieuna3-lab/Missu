import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { FlowScreen } from '@/components/FlowScreen';
import { FormMessage, TextLink } from '@/components/FormField';
import { typography } from '@/constants/theme';
import { useActivity } from '@/lib/activity/ActivityProvider';
import type { OwnershipRequest } from '@/lib/activity/types';
import { formatDateTime } from '@/lib/dateTime';
import { requestErrorMessage } from '@/lib/mockRequest';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { ReturnChatScreen } from './ReturnChatScreen';

// The requester's view of one request, by status (Figma 01.05 "내 반환 요청" branches):
// pending → 08.02, approved → 08.03, scheduled/handed → 08.04, completed → 08.05,
// rejected → 08-A.00. The screen re-renders as the holder moves the request along.
export function RequestStatusScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { requests } = useActivity();
  const request = requests.find((r) => r.id === id);
  const back = () => goBack('/history');

  if (!request)
    return (
      <FlowScreen
        title="내 반환 요청"
        onBack={back}
        heading="요청을 찾을 수 없어요"
        description="취소되었거나 올바르지 않은 요청 주소예요."
        actions={<ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />}
      />
    );

  switch (request.status) {
    case 'pending':
      return <WaitingScreen request={request} />;
    case 'rejected':
      return <RejectedScreen request={request} />;
    case 'approved':
      return (
        <ReturnChatScreen
          request={request}
          role="requester"
          onBack={back}
          onPropose={() => router.push({ pathname: '/requests/[id]/propose', params: { id } })}
          onReport={() => router.push({ pathname: '/requests/[id]/report', params: { id } })}
        />
      );
    case 'scheduled':
    case 'handed':
      return <ReceiveScreen request={request} />;
    case 'completed':
      return <CompletedScreen request={request} />;
  }
}

// Figma 08.02 with the 08.06 cancel confirmation.
function WaitingScreen({ request }: { request: OwnershipRequest }) {
  const { cancelRequest } = useActivity();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string>();

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    setError(undefined);
    try {
      await cancelRequest(request.id);
      setConfirming(false);
      router.replace('/search');
    } catch (caught) {
      setConfirming(false);
      setError(requestErrorMessage(caught));
      setCancelling(false);
    }
  }

  return (
    <FlowScreen
      title="내 반환 요청"
      onBack={() => goBack('/history')}
      centered
      heading="보관자가 확인 중이에요"
      actions={<ActionButton label="내 요청 보기" onPress={() => leaveFlowTo('/history')} />}
    >
      <Card title={request.itemName} centered>
        요청 접수 완료 · 보관자 확인 대기
      </Card>
      <Card title="반환 진행" centered>
        {'✓ 주인 확인 요청 접수\n● 보관자 검토 중\n○ 승인 후 대화·반환 일정 협의\n○ 물품 수령 확인'}
      </Card>
      <Text style={[typography.body, styles.center]}>
        승인되면 앱 안에서 반환 일정을 정할 수 있어요.
      </Text>
      <ActionButton
        label="검색 계속하기"
        variant="outline"
        onPress={() => router.replace('/search')}
      />
      {error && <FormMessage>{error}</FormMessage>}
      <View style={styles.linkRow}>
        <TextLink label="요청 취소" onPress={() => setConfirming(true)} />
      </View>
      {confirming && (
        <ConfirmDialog
          title="요청을 취소할까요?"
          message="작성한 주인 확인 요청이 취소됩니다."
          onCancel={() => setConfirming(false)}
          onConfirm={cancel}
          loading={cancelling}
        />
      )}
    </FlowScreen>
  );
}

// Figma 08-A.00
function RejectedScreen({ request }: { request: OwnershipRequest }) {
  void request;
  return (
    <FlowScreen
      title="주인 확인 결과"
      onBack={() => goBack('/history')}
      centered
      heading="확인 정보가 일치하지 않아요"
      actions={<ActionButton label="내 요청 보기" onPress={() => leaveFlowTo('/history')} />}
    >
      <Card title="요청이 승인되지 않았어요" centered>
        {
          '제출한 정보만으로 소유 여부를 확인하기 어려워요.\n보관자의 비공개 특징은 공개되지 않습니다.'
        }
      </Card>
      <ActionButton
        label="습득물 다시 검색"
        variant="outline"
        onPress={() => router.replace('/search')}
      />
    </FlowScreen>
  );
}

// Figma 08.04 with the 08.04-C confirmation.
function ReceiveScreen({ request }: { request: OwnershipRequest }) {
  const { confirmReceived } = useActivity();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const appointment = request.appointment;

  async function received() {
    if (submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await confirmReceived(request.id);
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
      title="반환 일정·수령 확인"
      onBack={() => goBack('/history')}
      heading="물품을 받은 뒤 확인해 주세요"
      actions={
        <ActionButton label="물품을 받았어요 · 수령 완료" onPress={() => setConfirming(true)} />
      }
    >
      <Card title="약속 장소">{appointment?.place ?? '미정'}</Card>
      <Card title="약속 시간">
        {appointment ? `${appointment.date} · ${appointment.time}` : '미정'}
      </Card>
      <Card title="수령 전 확인" blue>
        {'물품과 특징을 실물로 확인하고,\n물품을 받은 뒤 수령 완료를 눌러 주세요.'}
      </Card>
      {error && <FormMessage>{error}</FormMessage>}
      <View style={[styles.linkRow, styles.centerRow]}>
        <TextLink
          label="문제 신고"
          onPress={() =>
            router.push({ pathname: '/requests/[id]/report', params: { id: request.id } })
          }
        />
      </View>
      {confirming && (
        <ConfirmDialog
          title="물품을 받았나요?"
          message="수령을 확인하면 반환이 완료됩니다."
          onCancel={() => setConfirming(false)}
          onConfirm={received}
          loading={submitting}
        />
      )}
    </FlowScreen>
  );
}

// Figma 08.05
function CompletedScreen({ request }: { request: OwnershipRequest }) {
  const when = request.appointment
    ? `${request.appointment.date} ${request.appointment.time}`
    : formatDateTime(request.completedAt ?? request.createdAt);
  return (
    <FlowScreen
      title="반환 완료"
      onBack={() => goBack('/history')}
      centered
      heading="물건을 되찾았어요!"
      actions={<ActionButton label="내 반환 내역 보기" onPress={() => leaveFlowTo('/history')} />}
    >
      <Card title={request.itemName} centered>
        {`수령 완료 · ${when}`}
      </Card>
      <Text style={[typography.body, styles.center]}>
        {'수령 확인으로 반환이 완료됐어요.\n보관자도 내 등록 물품에서 완료 상태를 확인합니다.'}
      </Text>
      <ActionButton label="홈으로" variant="outline" onPress={() => leaveFlowTo('/home')} />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  linkRow: { minHeight: 44, justifyContent: 'center' },
  centerRow: { alignItems: 'center' },
});
