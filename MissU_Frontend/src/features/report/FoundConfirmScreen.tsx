import { router } from 'expo-router';
import { useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
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
      <Card title="공개되는 물품 정보">
        {`${found.name.trim()} · 사진 ${found.photos}장\n${foundAt ? formatDateTime(foundAt) : found.foundAtText} · ${found.place?.detail ?? ''}\n${categoryLabel(found.category)}`}
      </Card>
      <Card title="보관·수령 안내">
        {found.pickupGuide.trim()
          ? `${found.storage.trim()}\n${found.pickupGuide.trim()}`
          : found.storage.trim()}
      </Card>
      <Card title="비공개 특징 · 선택 입력" blue>
        {found.privateFeature.trim()
          ? `${found.privateFeature.trim()}\n주인 확인 시 보관자만 확인할 수 있어요.`
          : '입력하지 않았어요. 요청 내용을 바탕으로 실물을 확인하게 돼요.'}
      </Card>
      {error && <FormMessage>{error}</FormMessage>}
      <ActionButton
        label="정보 수정"
        variant="outline"
        onPress={() => router.dismissTo('/report/found')}
      />
    </FlowScreen>
  );
}
