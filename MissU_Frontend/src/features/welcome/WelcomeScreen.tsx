import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';
import { usePreview } from '@/lib/preview/PreviewProvider';

export function WelcomeScreen() {
  const { startLogin } = usePreview();
  return (
    <Screen welcome>
      <Header welcome />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.illustrationCard}>
          <Image
            source={require('../../../assets/images/welcome.png')}
            contentFit="contain"
            accessibilityLabel="분실물을 찾는 돋보기, 헤드폰과 열쇠"
            style={styles.illustration}
          />
        </View>
        <Text accessibilityRole="header" style={[typography.heading, styles.title]}>
          {'미슈에 오신 것을\n환영합니다'}
        </Text>
        <Text style={[typography.body, styles.description]}>
          {'잃어버린 물건과 기다리는 주인을\n다시 이어드릴게요.'}
        </Text>
        <View style={styles.note}>
          <Text style={[typography.label, { fontSize: 14, lineHeight: 22, color: '#283345' }]}>
            로그인 없이도 찾을 수 있어요
          </Text>
          <Text style={typography.body}>습득물 검색과 상세 조회는 누구나 가능합니다.</Text>
        </View>
      </ScrollView>
      <View style={styles.actions}>
        <ActionButton label="습득물 먼저 찾아보기" large onPress={() => router.push('/search')} />
        <ActionButton
          label="로그인 / 회원가입"
          variant="plain"
          style={{ minHeight: 48 }}
          large
          onPress={() => startLogin('home')}
        />
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 },
  illustrationCard: {
    height: 192,
    borderRadius: 24,
    backgroundColor: '#F3F6FC',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 8px 24px rgba(38,64,115,0.08)',
  },
  illustration: { width: 282, maxWidth: '100%', height: 188 },
  title: { fontSize: 28, lineHeight: 40 },
  description: { fontSize: 15, lineHeight: 24 },
  note: { backgroundColor: '#F6F7F9', borderRadius: 16, padding: 16, gap: 8 },
  actions: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 14, gap: 8 },
});
