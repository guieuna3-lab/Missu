import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { ChoiceRow } from '@/components/ChoiceRow';
import { ConfirmDialog } from '@/components/Dialog';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage } from '@/components/FormField';
import { Icon } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { reportReasons, type Party, type ReportReason } from '@/lib/activity/types';
import { requestErrorMessage } from '@/lib/mockRequest';
import { MAX_PHOTOS } from '@/features/report/mockPhotoPicker';
import { PhotoSourceSheet } from '@/features/report/PhotoAttachment';

// Figma 08-A.01 with the 08-A.01-C confirmation. Opened by either side from the chat,
// by the requester from 08.04 and by the holder from 08-B.01.
export function SuspiciousReportScreen({
  requestId,
  role,
  onBack,
  onSubmitted,
}: {
  requestId: string;
  role: Party;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const { reportSuspicious } = useActivity();
  const [reason, setReason] = useState<ReportReason>();
  const [reasonError, setReasonError] = useState<string>();
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState(0);
  const [choosingPhoto, setChoosingPhoto] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  function askConfirm() {
    if (!reason) {
      setReasonError('신고 사유를 선택해 주세요.');
      return;
    }
    setConfirming(true);
  }

  async function submit() {
    if (submitting || !reason) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await reportSuspicious(requestId, {
        by: role,
        reason,
        description: description.trim(),
        photos,
      });
      setConfirming(false);
      onSubmitted();
    } catch (caught) {
      setConfirming(false);
      setError(requestErrorMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <FlowScreen
      title="의심 요청 · 신고"
      onBack={onBack}
      heading="의심되는 내용을 알려 주세요"
      actions={<ActionButton label="신고 접수" onPress={askConfirm} />}
    >
      <View style={styles.reasons} accessibilityRole="radiogroup">
        <Text style={typography.label}>신고 사유 *</Text>
        {reportReasons.map((option) => {
          const active = option.value === reason;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ checked: active }}
              onPress={() => {
                setReason(option.value);
                setReasonError(undefined);
              }}
              style={({ pressed }) => [
                styles.reason,
                active && styles.activeReason,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.reasonLabel}>{option.label}</Text>
              {active && <Icon name="check" tintColor={colors.blue} />}
            </Pressable>
          );
        })}
        {reasonError && <FormMessage>{reasonError}</FormMessage>}
      </View>
      <FormField
        label="상황 설명"
        placeholder="요청 내용을 입력해 주세요"
        value={description}
        onChangeText={setDescription}
      />
      <Card title="첨부 시 주의" blue accent>
        주소·결제정보 등 불필요한 개인정보는 가려 주세요.
      </Card>
      <ChoiceRow
        icon="camera"
        title="사진 첨부"
        description={
          photos > 0
            ? `사진 ${photos}장 첨부됨 · 최대 ${MAX_PHOTOS}장`
            : '개인정보를 가린 사진을 첨부해 주세요.'
        }
        onPress={() => setChoosingPhoto(true)}
      />
      {error && <FormMessage>{error}</FormMessage>}
      {choosingPhoto && (
        <PhotoSourceSheet
          onClose={() => setChoosingPhoto(false)}
          onAdded={() => setPhotos((count) => Math.min(MAX_PHOTOS, count + 1))}
          onDenied={() =>
            setError('사진을 첨부하려면 기기 설정에서 카메라 또는 사진 접근을 허용해 주세요.')
          }
        />
      )}
      {confirming && (
        <ConfirmDialog
          title="신고를 접수할까요?"
          message="작성한 사유와 첨부 사진이 전달됩니다."
          onCancel={() => setConfirming(false)}
          onConfirm={submit}
          loading={submitting}
        />
      )}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  reasons: { gap: 8 },
  reason: {
    minHeight: 64,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  activeReason: { borderWidth: 1.5, borderColor: colors.blue },
  pressed: { opacity: 0.75 },
  reasonLabel: { ...typography.label, fontWeight: '700' },
});
