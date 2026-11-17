import { router } from 'expo-router';
import { useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Chip, InfoCard, InfoRow } from '@/components/InfoList';
import { ItemThumb } from '@/components/ItemThumb';
import { colors, typography } from '@/constants/theme';
import { FlowScreen } from '@/components/FlowScreen';
import { FormMessage } from '@/components/FormField';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { categoryLabel } from '@/lib/activity/types';
import { formatDateTime, parseDateTime } from '@/lib/dateTime';
import { requestErrorMessage } from '@/lib/mockRequest';
import { goBack } from '@/lib/navigation';
import { useReportDraft } from './ReportDraft';

// Figma 05.04
export function FoundConfirmScreen() {
  const { found, resetFound } = useReportDraft();
  const { registerFoundItem } = useActivity();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const foundAt = parseDateTime(found.foundAtText);
  const placeName = found.place?.name || found.place?.detail || '';

  async function register() {
    if (submitting) return;
    if (!foundAt || !found.place) {
      goBack('/report/found');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const item = await registerFoundItem({
        category: found.category,
        name: found.name.trim(),
        foundAt,
        place: found.place,
        photos: found.photos,
        attachments: found.attachments,
        photoIds: found.attachments?.map((p) => p.id),
        storage: found.storage.trim(),
        pickupGuide: found.pickupGuide.trim(),
        privateFeature: found.privateFeature.trim(),
      });
      router.replace({ pathname: '/report/found/done', params: { id: item.id } });
      resetFound();
    } catch (requestError) {
      setError(requestErrorMessage(requestError));
      setSubmitting(false);
    }
  }

  return (
    <FlowScreen
      title="등록 내용 확인"
      onBack={() => goBack('/report/found/storage')}
      step="3 / 3  최종 확인"
      heading="이 내용으로 등록할까요?"
      actions={<ActionButton label="습득물 등록하기" onPress={register} loading={submitting} />}
    >
      <Text style={styles.label}>목록에는 이렇게 보여요</Text>
      <View style={styles.preview}>
        <ItemThumb
          name={found.name.trim()}
          category={found.category}
          photoUrl={found.attachments?.[0]?.preview}
        />
        <View style={styles.previewText}>
          <Text style={styles.previewName} numberOfLines={1}>
            {found.name.trim()}
          </Text>
          <Text style={styles.previewMeta} numberOfLines={1}>
            {[placeName, '방금 전', `사진 ${found.photos}장`].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Chip label="보관 중" tone="green" />
      </View>
      <SectionLabel title="공개되는 정보" onEdit={() => router.dismissTo('/report/found')} />
      <InfoCard>
        <InfoRow
          icon="info-date"
          label="습득 일시"
          value={foundAt ? formatDateTime(foundAt) : found.foundAtText}
        />
        <InfoRow
          icon="info-place"
          label="습득 장소"
          value={placeName || '-'}
          sub={
            found.place?.detail && found.place.detail !== placeName ? found.place.detail : undefined
          }
        />
        <InfoRow icon="cat-other" label="분류" value={categoryLabel(found.category)} />
        <InfoRow
          icon="info-storage"
          label="보관·수령"
          value={found.storage.trim()}
          sub={found.pickupGuide.trim() || undefined}
          last
        />
      </InfoCard>
      <SectionLabel
        title="비공개 특징 · 선택"
        onEdit={() => router.dismissTo('/report/found/storage')}
      />
      <View style={styles.secret}>
        <View style={styles.secretIcon}>
          <Icon name="lock" size={18} />
        </View>
        <View style={styles.secretText}>
          <Text style={styles.secretTitle}>
            {found.privateFeature.trim() || '입력하지 않았어요'}
          </Text>
          <Text style={styles.secretBody}>
            {found.privateFeature.trim()
              ? '목록과 상세에는 보이지 않아요.'
              : '요청 내용을 바탕으로 실물을 확인하게 돼요.'}
          </Text>
          {!!found.privateFeature.trim() && (
            <Text style={styles.secretNote}>주인 확인 요청이 오면 보관자만 비교해요</Text>
          )}
        </View>
      </View>
      {error && <FormMessage>{error}</FormMessage>}
    </FlowScreen>
  );
}

function SectionLabel({ title, onEdit }: { title: string; onEdit: () => void }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{title}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title + ' 수정'}
        onPress={onEdit}
        hitSlop={8}
      >
        <Text style={styles.edit}>수정</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.label, fontWeight: '700', color: '#4E5968', marginTop: 4 },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  edit: { ...typography.label, fontSize: 13, fontWeight: '700', color: colors.blue },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#BFD3F7',
    backgroundColor: colors.white,
  },
  previewText: { flex: 1, gap: 2 },
  previewName: { ...typography.label, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  previewMeta: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  secret: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FFF8EC',
  },
  secretIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFE9C2',
  },
  secretText: { flex: 1, gap: 2 },
  secretTitle: { ...typography.label, fontSize: 14, fontWeight: '700' },
  secretBody: { ...typography.body, color: colors.body },
  secretNote: { ...typography.label, fontSize: 12, color: '#B7791F', marginTop: 4 },
});
