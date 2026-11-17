import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/constants/theme';

/** 화면 가운데 로딩. 부모가 남은 높이를 채우도록(flexGrow: 1) 두면 세로 가운데에 옵니다. */
export function LoadingState({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.blue} />
      <Text style={styles.title}>{title}</Text>
      {!!description && <Text style={styles.description}>{description}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  title: {
    ...typography.label,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: { ...typography.body, color: colors.muted, textAlign: 'center' },
});
