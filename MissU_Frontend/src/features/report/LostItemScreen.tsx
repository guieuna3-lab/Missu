import { router } from 'expo-router';
import { useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField } from '@/components/FormField';
import { goBack } from '@/lib/navigation';
import { CategoryTiles } from './CategoryTiles';
import { useReportDraft } from './ReportDraft';

// Figma 04.02 (and 04.02-E for the missing name). Editing a report from 01.08 reuses the
// same three steps with the draft prefilled.
export function LostItemScreen() {
  const { lost, updateLost } = useReportDraft();
  const [error, setError] = useState<string>();
  const editing = !!lost.editingId;

  function next() {
    if (!lost.name.trim()) {
      setError('물품명을 입력해 주세요.');
      return;
    }
    router.push('/report/lost/when');
  }

  return (
    <FlowScreen
      title={editing ? '분실 신고 수정' : '분실 물품 입력'}
      onBack={() => goBack('/report')}
      step="1 / 3"
      heading="무엇을 잃어버렸나요?"
      description="물품명과 기억나는 특징을 직접 적어 주세요."
      actions={<ActionButton label="다음 · 분실 시점" onPress={next} />}
    >
      <CategoryTiles value={lost.category} onChange={(category) => updateLost({ category })} />
      <FormField
        label="물품명"
        required
        placeholder="물품명을 직접 입력하세요"
        value={lost.name}
        onChangeText={(name) => {
          updateLost({ name });
          setError(undefined);
        }}
        error={error}
        returnKeyType="next"
      />
      <FormField
        label="물품 특징 (선택)"
        placeholder="예: 앞면에 흰색 고양이 스티커"
        value={lost.feature}
        onChangeText={(feature) => updateLost({ feature })}
        onSubmitEditing={next}
      />
      <Card title="검색과 다른 점" blue>
        {
          '분실 신고는 내 물품 정보를 남기는 절차입니다.\n등록 후 내것에서 신고 내용을 확인할 수 있어요.'
        }
      </Card>
    </FlowScreen>
  );
}
