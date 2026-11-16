import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage } from '@/components/FormField';
import { colors, typography } from '@/constants/theme';
import { useActivity } from '@/lib/activity/ActivityProvider';
import type { OwnershipRequest, Party } from '@/lib/activity/types';
import { requestErrorMessage } from '@/lib/mockRequest';

const partyLabel: Record<Party, string> = { requester: '요청자', holder: '보관자' };

// Figma 08.03 (requester) and 08-B.02-A (holder), with the 08.03-E empty state. Both sides
// chat, propose an appointment and confirm the other side's proposal here.
export function ReturnChatScreen({
  request,
  role,
  onBack,
  onPropose,
  onReport,
}: {
  request: OwnershipRequest;
  role: Party;
  onBack: () => void;
  onPropose: () => void;
  onReport: () => void;
}) {
  const { sendMessage, confirmAppointment } = useActivity();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const empty = request.messages.length === 0 && !request.proposal && !request.appointment;
  const other = role === 'requester' ? '보관자' : `${request.requesterName} · 요청자`;

  async function send() {
    if (sending || !draft.trim()) return;
    setSending(true);
    setError(undefined);
    try {
      await sendMessage(request.id, role, draft);
      setDraft('');
    } catch (caught) {
      setError(requestErrorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  async function confirm() {
    if (confirming) return;
    setConfirming(true);
    setError(undefined);
    try {
      await confirmAppointment(request.id, role, request.proposal?.id);
    } catch (caught) {
      setError(requestErrorMessage(caught));
    } finally {
      setConfirming(false);
    }
  }

  // Pinned at the bottom of the screen under the appointment button.
  const composer = (
    <View style={styles.composer}>
      <View style={styles.composerField}>
        <FormField
          label="메시지"
          hideLabel
          placeholder="채팅을 입력하세요"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          returnKeyType="send"
          editable={!sending}
        />
      </View>
      <ActionButton
        label="보내기"
        onPress={send}
        loading={sending}
        disabled={!draft.trim()}
        style={styles.sendButton}
      />
    </View>
  );

  const proposeButton = (
    <ActionButton
      label="약속 장소·시간 제안"
      variant={role === 'requester' ? 'outline' : 'primary'}
      onPress={onPropose}
      style={role === 'requester' ? styles.blueOutline : undefined}
    />
  );

  const reportAction = {
    label: '신고',
    accessibilityLabel: '의심되는 요청 신고',
    onPress: onReport,
    danger: true,
  };
  const bottom = (
    <>
      {proposeButton}
      {composer}
    </>
  );
  const notice = (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>
        <Text style={styles.noticeStrong}>선입금·외부 링크</Text> 요청은 오른쪽 위 신고를 이용해
        주세요.
      </Text>
    </View>
  );

  if (empty)
    return (
      <FlowScreen
        title="반환 대화"
        onBack={onBack}
        heading="아직 메시지가 없어요"
        description="반환 장소와 시간을 대화로 정해 보세요."
        headerAction={reportAction}
        actions={bottom}
      >
        {notice}
        {error && <FormMessage>{error}</FormMessage>}
      </FlowScreen>
    );

  return (
    <FlowScreen
      title="반환 대화"
      onBack={onBack}
      heading="반환 일정을 정해 주세요"
      headerAction={reportAction}
      actions={bottom}
    >
      <Card title={request.itemName} blue>
        {`주인 확인 완료 · ${request.storageName} 보관`}
      </Card>
      {notice}
      {request.messages.map((message) => {
        const mine = message.by === role;
        return (
          <View key={message.id} style={[styles.bubbleRow, mine && styles.mineRow]}>
            <View style={[styles.bubble, mine && styles.mineBubble]}>
              <Text style={typography.label}>{mine ? `나 · ${partyLabel[role]}` : other}</Text>
              <Text style={typography.body}>{message.text}</Text>
            </View>
          </View>
        );
      })}
      {request.appointment && (
        <Card title="약속 확정">
          {`${request.appointment.place} · ${request.appointment.date} ${request.appointment.time}`}
        </Card>
      )}
      {request.proposal && (
        <View style={styles.proposal}>
          <Card title={`약속 제안 · ${partyLabel[request.proposal.by]}`}>
            {`${request.proposal.place} · ${request.proposal.date} ${request.proposal.time}`}
          </Card>
          {request.proposal.by === role ? (
            <Text style={styles.waiting}>상대방의 확인을 기다리고 있어요.</Text>
          ) : (
            <ActionButton label="확인" onPress={confirm} loading={confirming} />
          )}
        </View>
      )}
      {error && <FormMessage>{error}</FormMessage>}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  bubbleRow: { flexDirection: 'row' },
  mineRow: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    padding: 16,
    gap: 4,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  mineBubble: { backgroundColor: colors.lightBlue },
  proposal: { gap: 12 },
  waiting: { ...typography.body, textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  composerField: { flex: 1 },
  sendButton: { minWidth: 60, paddingHorizontal: 12 },
  notice: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F3D1D1',
    backgroundColor: colors.white,
  },
  noticeText: { ...typography.body, fontSize: 12, lineHeight: 18 },
  noticeStrong: { color: colors.danger, fontWeight: '700' },
  blueOutline: { borderColor: colors.blue },
});
