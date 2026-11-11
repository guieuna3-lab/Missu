import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { typography } from '@/constants/theme';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { leaveFlowTo } from '@/lib/navigation';

// Figma 05.05
export function FoundDoneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { foundItems } = useActivity();
  const item = foundItems.find((i) => i.id === id);
  return (
    <FlowScreen
      title="습득물 등록 완료"
      onBack={() => router.dismissTo('/report')}
      centered
      heading="습득물 등록을 완료했어요"
      actions={
        <ActionButton
          label="등록한 물품 보기"
          onPress={() => {
            router.dismissTo('/report');
            router.push({ pathname: '/my-items/[id]', params: { id } });
          }}
        />
      }
    >
      {item && (
        <Card title={item.name} centered>
          {`${item.storage} · 보관 중`}
        </Card>
      )}
      <Text style={[typography.body, styles.center]}>
        {'내것 → 내가 등록한 습득물에서\n물품 정보와 받은 반환 요청을 확인할 수 있어요.'}
      </Text>
      <ActionButton label="홈으로" variant="outline" onPress={() => leaveFlowTo('/home')} />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
});
