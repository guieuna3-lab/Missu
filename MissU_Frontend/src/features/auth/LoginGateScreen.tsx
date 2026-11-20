import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionBar, ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';
import { usePreview } from '@/lib/preview/PreviewProvider';

export function LoginGateScreen({ kind }: { kind: 'history' | 'report' }) {
  const { startLogin, restoringSession, sessionNotice, retrySession } = usePreview();
  const report = kind === 'report';
  return (
    <Screen>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.lock}>
          <Icon name="lock" />
        </View>
        <Text accessibilityRole="header" style={[typography.heading, styles.center]}>
          {restoringSession
            ? '저장된 로그인을 확인하고 있어요'
            : report
              ? '신고·등록은 로그인 후 가능해요'
              : '로그인이 필요해요'}
        </Text>
        <Text style={[typography.body, styles.center]}>
          {report
            ? '분실 신고와 습득물 등록은\n로그인 후 이용할 수 있어요.'
            : '내 신고와 반환 요청 내역은\n로그인 후 확인할 수 있어요.'}
        </Text>
        <View style={styles.card}>
          {!!sessionNotice && (
            <Card title={sessionNotice} onPress={retrySession}>
              다시 확인하기
            </Card>
          )}
          <Card
            blue
            centered
            title={report ? '등록과 반환 내역을 안전하게' : '검색과 지도는 누구나'}
          >
            {report
              ? '내가 등록한 물품과 받은 요청을\n내것 탭에서 관리할 수 있어요.'
              : '로그인 없이 물품 검색과 공개 상세 조회가 가능합니다.'}
          </Card>
        </View>
      </ScrollView>
      <ActionBar>
        <ActionButton
          label={restoringSession ? '로그인 확인 중' : '로그인하고 계속하기'}
          disabled={restoringSession}
          onPress={() => startLogin(report ? 'report' : 'mine')}
        />
      </ActionBar>
      <BottomNavigation selected={kind} />
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingVertical: 24,
    gap: 16,
  },
  lock: { width: 40, height: 40 },
  center: { textAlign: 'center' },
  card: { alignSelf: 'stretch' },
});
