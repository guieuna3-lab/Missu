import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          MissU
        </Text>
        <Text style={styles.description}>분실물 탐색 및 반환 서비스</Text>
        <Text style={styles.note}>개발 환경 확인용 시작 화면입니다.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: '#111827', fontSize: 32, fontWeight: '700' },
  description: { color: '#374151', fontSize: 18 },
  note: { color: '#6B7280', fontSize: 14 },
});
