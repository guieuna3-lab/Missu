import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomNavigation } from '@/components/BottomNavigation';
import { ChoiceRow } from '@/components/ChoiceRow';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';
import { useReportDraft } from './ReportDraft';

// Figma 04.01: the 신고 tab for members. Guests see LoginGateScreen instead (01.06).
export function ReportTypeScreen() {
  const { resetLost, resetFound } = useReportDraft();
  return (
    <Screen>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={typography.heading}>
          무엇을 할까요?
        </Text>
        <Text style={typography.body}>잃어버렸나요, 아니면 습득하셨나요?</Text>
        <View style={styles.choices}>
          <ChoiceRow
            icon="search"
            title="분실 신고"
            description="내 물건을 잃어버렸어요"
            onPress={() => {
              resetLost();
              router.push('/report/lost');
            }}
          />
          <ChoiceRow
            icon="box"
            title="습득물 등록"
            description="남의 물건을 주웠어요"
            onPress={() => {
              resetFound();
              router.push('/report/found');
            }}
          />
        </View>
      </ScrollView>
      <BottomNavigation selected="report" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 8 },
  choices: { marginTop: 16, gap: 12 },
});
