import { Redirect, router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { ActionBar, ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';
import { previewActivity } from '@/lib/preview/fixtures';
import { usePreview } from '@/lib/preview/PreviewProvider';

export function RegisteredItemScreen() {
  const { profile } = usePreview();
  if (!profile) return <Redirect href="/history" />;
  return (
    <Screen>
      <Header
        title="내 등록 물품"
        onBack={() => router.replace('/history')}
        backLabel="내역으로 돌아가기"
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={typography.heading}>
          {previewActivity.itemTitle}
        </Text>
        <Card title="보관 중">{previewActivity.storage}</Card>
        <Card title="받은 주인 확인 요청 · 1건" blue>
          {previewActivity.request}
        </Card>
        <ActionButton label="등록 정보 수정" variant="outline" />
      </ScrollView>
      <ActionBar>
        <ActionButton label="받은 요청 확인" />
      </ActionBar>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
});
