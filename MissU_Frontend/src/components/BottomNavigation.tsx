import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { unavailableHint } from '@/constants/messages';
import { colors } from '@/constants/theme';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { Icon, type IconName } from './Icon';

type Tab = 'home' | 'report' | 'history';
export function BottomNavigation({ selected }: { selected: Tab }) {
  const { profile } = usePreview();
  const tabs: { key: string; label: string; icon: IconName; onPress?: () => void }[] = [
    {
      key: 'home',
      label: '홈',
      icon: selected === 'home' ? 'home-active' : 'home',
      onPress: () => router.replace('/home'),
    },
    { key: 'nearby', label: '근처', icon: 'map' },
    {
      key: 'report',
      label: '신고',
      icon: selected === 'report' ? 'edit-active' : 'edit',
      onPress: profile ? undefined : () => router.replace('/report'),
    },
    {
      key: 'history',
      label: '내것',
      icon: selected === 'history' ? 'user-active' : 'user',
      onPress: () => router.replace('/history'),
    },
  ];
  return (
    <View style={styles.navigation}>
      {tabs.map((tab) => (
        <Pressable
          key={tab.key}
          accessibilityRole="tab"
          accessibilityLabel={tab.label}
          accessibilityState={{ selected: selected === tab.key, disabled: !tab.onPress }}
          accessibilityHint={!tab.onPress ? unavailableHint : undefined}
          disabled={!tab.onPress}
          onPress={tab.onPress}
          style={[styles.tab, selected === tab.key && { backgroundColor: colors.lightBlue }]}
        >
          <Icon name={tab.icon} />
          <Text style={[styles.tabLabel, selected === tab.key && { color: colors.blue }]}>
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  navigation: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
    borderTopWidth: 0.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 8,
  },
  tabLabel: {
    fontFamily: 'NotoSansKR',
    fontWeight: '500',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: -0.15,
    color: colors.muted,
  },
});
