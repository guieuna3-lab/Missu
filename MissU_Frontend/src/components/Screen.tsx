import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography } from '@/constants/theme';
import { Button } from './Button';

export const iconSources = {
  back: require('../../assets/icons/back.svg'),
  search: require('../../assets/icons/search.svg'),
  home: require('../../assets/icons/home.svg'),
  map: require('../../assets/icons/map.svg'),
  edit: require('../../assets/icons/edit.svg'),
  user: require('../../assets/icons/user.svg'),
};
export function Icon({ name }: { name: keyof typeof iconSources }) {
  return (
    <Image source={iconSources[name]} style={styles.icon} contentFit="contain" accessible={false} />
  );
}
export function Screen({
  title,
  onBack,
  onLogin,
  children,
  action,
  navigation,
}: {
  title: string;
  onBack: () => void;
  onLogin?: () => void;
  children: ReactNode;
  action?: ReactNode;
  navigation?: ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.page}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            style={styles.back}
          >
            <Icon name="back" />
          </Pressable>
          <Text accessibilityRole="header" style={[typography.action, styles.title]}>
            {title}
          </Text>
          {onLogin && (
            <Pressable accessibilityRole="button" onPress={onLogin} style={styles.login}>
              <Text style={[typography.label, styles.white]}>로그인</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.body}>{children}</View>
        {action && <View style={styles.actions}>{action}</View>}
        {navigation}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function BottomNavigation({ onSelect }: { onSelect: (name: string) => void }) {
  const tabs = [
    { label: '홈', icon: 'home' },
    { label: '근처', icon: 'map' },
    { label: '신고', icon: 'edit' },
    { label: '내것', icon: 'user' },
  ] as const;
  return (
    <View style={styles.nav}>
      {tabs.map((tab, i) => (
        <Pressable
          key={tab.label}
          accessibilityRole="tab"
          accessibilityState={{ selected: i === 0 }}
          accessibilityLabel={tab.label}
          onPress={() => onSelect(tab.label)}
          style={[styles.tab, i === 0 && styles.selected]}
        >
          <Icon name={tab.icon} />
          <Text style={[typography.label, styles.tabLabel, i === 0 && styles.blue]}>
            {tab.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Notice({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <Modal visible={!!message} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={typography.action}>
            안내
          </Text>
          <Text style={typography.body}>{message}</Text>
          <Button onPress={onClose}>확인</Button>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  page: {
    flex: 1,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.white,
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  back: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 24, height: 24 },
  title: { flex: 1, fontSize: 15 },
  login: {
    backgroundColor: colors.blue,
    minHeight: 32,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
  },
  white: { color: colors.white },
  blue: { color: colors.blue },
  body: { flex: 1 },
  actions: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  nav: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  tab: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
  },
  selected: { backgroundColor: colors.lightBlue },
  tabLabel: { fontSize: 11, lineHeight: 16, color: colors.muted },
  overlay: {
    flex: 1,
    backgroundColor: '#00000066',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 350,
    padding: 24,
    gap: 20,
    borderRadius: 16,
    backgroundColor: colors.white,
  },
});
