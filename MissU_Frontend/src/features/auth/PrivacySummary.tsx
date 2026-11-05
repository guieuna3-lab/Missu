import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/constants/theme';

const sections = [
  { title: '수집 항목', body: '이메일, 닉네임, 비밀번호' },
  { title: '이용 목적', body: '로그인, 비밀번호 재설정, 이용자 구분' },
  {
    title: '공개 범위',
    body: '닉네임만 다른 이용자에게 표시됩니다.\n이메일과 비밀번호는 공개하지 않습니다.',
  },
  {
    title: '보유 · 거부 안내',
    body: '계정 정보: 회원탈퇴까지\n동의를 거부하면 가입이 어렵지만 검색은 가능합니다.',
  },
];

// Same content on 02.03-A (compact) and 02-A.04.
export function PrivacySummary({ compact = false }: { compact?: boolean }) {
  return (
    <>
      {sections.map((section) => (
        <View key={section.title} style={[styles.card, compact && styles.compactCard]}>
          <Text style={[typography.label, { color: colors.blue }]}>{section.title}</Text>
          <Text style={[typography.body, compact && styles.small]}>{section.body}</Text>
        </View>
      ))}
      <Text style={[typography.body, styles.small]}>
        주민등록번호·신분증 사본·집 주소는 수집하지 않습니다.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.lightBlue, borderRadius: 12, padding: 16, gap: 6 },
  compactCard: { paddingVertical: 12, gap: 4 },
  small: { fontSize: 12, lineHeight: 18 },
});
