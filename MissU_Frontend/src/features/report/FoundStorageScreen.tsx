import { router } from 'expo-router';
import { useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField } from '@/components/FormField';
import { PlaceSearchField } from '@/features/place/PlaceSearchField';
import { goBack } from '@/lib/navigation';
import { useReportDraft } from './ReportDraft';

// Figma 05.03
export function FoundStorageScreen() {
  const { found, updateFound } = useReportDraft();
  const [error, setError] = useState<string>();

  function next() {
    if (!found.storage.trim()) {
      setError('보관 장소를 입력해 주세요.');
      return;
    }
    router.push('/report/found/confirm');
  }

  return (
    <FlowScreen
      title="보관 정보"
      onBack={() => goBack('/report/found')}
      step="2 / 3  보관 정보"
      heading="어디에 보관 중인가요?"
      actions={<ActionButton label="다음 · 등록 내용 확인" onPress={next} />}
    >
      <PlaceSearchField
        label="보관 장소"
        required
        placeholder="중앙도서관 1층 안내데스크"
        value={found.storage}
        onChangeText={(storage) => {
          updateFound({ storage });
          setError(undefined);
        }}
        error={error}
        returnKeyType="next"
      />
      <FormField
        label="수령 안내 (선택)"
        placeholder="평일 09:00–18:00, 방문 전 확인"
        value={found.pickupGuide}
        onChangeText={(pickupGuide) => updateFound({ pickupGuide })}
        returnKeyType="next"
      />
      <FormField
        label="주인만 아는 특징 (선택)"
        placeholder="케이스 안쪽의 파란색 별 스티커"
        value={found.privateFeature}
        onChangeText={(privateFeature) => updateFound({ privateFeature })}
        onSubmitEditing={next}
      />
      <Card title="주인 확인에 도움이 돼요" blue>
        {
          '사진에 보이지 않는 특징을 적어 주세요.\n검색·상세 화면에는 공개되지 않습니다.\n특징이 없으면 비워 두어도 등록할 수 있어요.'
        }
      </Card>
    </FlowScreen>
  );
}
