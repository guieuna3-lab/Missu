import { Redirect } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { colors, typography } from '@/constants/theme';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { AuthScreen } from './AuthScreen';

// Figma 02.05
export function SignupCompleteScreen() {
  const { profile, continueAfterLogin } = usePreview();
  if (!profile) return <Redirect href="/signup" />;
  return (
    <AuthScreen
      title="가입 완료"
      centered
      actions={
        <>
          <ActionButton label="MissU 시작하기" onPress={() => continueAfterLogin()} />
          <ActionButton
            label="회원 습득물 둘러보기"
            variant="outline"
            onPress={() => continueAfterLogin('/search')}
          />
        </>
      }
    >
      <Text
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={[typography.heading, styles.center, { color: colors.blue }]}
      >
        ✓
      </Text>
      <Text accessibilityRole="header" style={[typography.heading, styles.center]}>
        가입이 완료됐어요!
      </Text>
      <Text style={[typography.body, styles.center]}>
        {'이제 분실 신고와 습득물 등록을\n바로 이용할 수 있습니다.'}
      </Text>
      <Card title="이메일 인증 완료" blue centered accent>
        별도의 승인 없이 바로 시작할 수 있어요.
      </Card>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
});
