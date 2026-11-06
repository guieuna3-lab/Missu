import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/constants/theme';
import { usePreview, type LoginOrigin } from '@/lib/preview/PreviewProvider';
import { ActionButton } from './ActionButton';
import { Icon } from './Icon';

export function Header({
  welcome = false,
  title,
  onBack,
  backLabel = '뒤로 가기',
  accountOrigin,
}: {
  welcome?: boolean;
  /** Shows a screen title instead of the logo. */
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  /** Shows the account controls beside a titled header. */
  accountOrigin?: LoginOrigin;
}) {
  const { profile, startLogin } = usePreview();
  const showAccount = !welcome && (title === undefined || accountOrigin !== undefined);
  return (
    <View style={[styles.header, welcome && { paddingHorizontal: 24 }]}>
      {title !== undefined ? (
        <View style={styles.titleHeader}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={backLabel}
              onPress={onBack}
              hitSlop={10}
            >
              <Icon name="back" />
            </Pressable>
          ) : (
            <View style={styles.backSpace} />
          )}
          <Text style={[typography.action, styles.title]}>{title}</Text>
        </View>
      ) : (
        <Text style={[styles.wordmark, welcome && { fontSize: 18, lineHeight: 25 }]}>
          MissU<Text style={welcome && { color: colors.blue }}>.</Text>
        </Text>
      )}
      {showAccount &&
        (profile ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${profile.name} 님 내역`}
            onPress={() => router.replace('/history')}
            style={styles.member}
          >
            <Text numberOfLines={1} style={typography.label}>
              {profile.name} 님
            </Text>
          </Pressable>
        ) : (
          <ActionButton
            label="로그인"
            onPress={() => startLogin(accountOrigin ?? 'home')}
            style={styles.login}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 48,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
  },
  wordmark: {
    fontFamily: 'Outfit',
    fontWeight: '900',
    fontSize: 22,
    lineHeight: 32,
    color: colors.ink,
  },
  member: {
    maxWidth: '55%',
    minWidth: 108,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  login: { minHeight: 32, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6 },
  titleHeader: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 18 },
  // Keeps the title at the same position on screens without a back button (Figma 02.05).
  backSpace: { width: 24 },
  title: { flexShrink: 1, color: colors.ink, fontSize: 15 },
});
