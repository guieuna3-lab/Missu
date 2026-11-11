import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { formatDate, formatTime } from '@/lib/dateTime';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { FoundItemScreen } from './FoundItemScreen';
import { useReportDraft } from './ReportDraft';

// Figma 05.02-A: the registration form prefilled from a registered item (01.07 "등록 정보 수정").
export function FoundItemEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { foundItems } = useActivity();
  const { found, resetFound } = useReportDraft();
  const item = foundItems.find((i) => i.id === id);
  const ready = !!item && found.editingId === item.id;

  useEffect(() => {
    if (!item || found.editingId === item.id) return;
    resetFound({
      editingId: item.id,
      category: item.category,
      name: item.name,
      foundAtText: `${formatDate(item.foundAt)} ${formatTime(item.foundAt)}`,
      place: item.place,
      photos: item.photos,
      storage: item.storage,
      pickupGuide: item.pickupGuide,
      privateFeature: item.privateFeature,
    });
  }, [item, found.editingId, resetFound]);

  if (!item)
    return (
      <FlowScreen
        title="습득물 등록 정보 수정"
        onBack={() => goBack('/history')}
        heading="물품을 찾을 수 없어요"
        description="삭제되었거나 올바르지 않은 물품 주소예요."
        actions={<ActionButton label="내역으로 돌아가기" onPress={() => leaveFlowTo('/history')} />}
      />
    );
  if (!ready) return <FlowScreen title="습득물 등록 정보 수정" onBack={() => goBack('/history')} />;
  return <FoundItemScreen />;
}
