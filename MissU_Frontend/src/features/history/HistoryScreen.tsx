import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionBar, ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { LoginGateScreen } from '@/features/auth/LoginGateScreen';
import { previewActivity } from '@/lib/preview/fixtures';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { ProfileModal } from './ProfileModal';

export function HistoryScreen() {
  const { profile, updateProfile, exitMemberPreview } = usePreview();
  const [editing, setEditing] = useState(false);
  if (!profile) return <LoginGateScreen kind="history" />;
  return (
    <Screen>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <Text style={typography.label}>나의 프로필</Text>
          <Text style={typography.body}>
            {profile.name} · {profile.email}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="정보 수정"
            onPress={() => setEditing(true)}
            hitSlop={8}
          >
            <Text style={[typography.label, { color: colors.blue }]}>정보 수정</Text>
          </Pressable>
        </View>
        <Text accessibilityRole="header" style={typography.heading}>
          내 활동
        </Text>
        <Card title="내 분실 신고" disabled>
          {previewActivity.lost}
        </Card>
        <Card title="내 반환 요청" disabled>
          {previewActivity.returned}
        </Card>
        <Card title="내가 등록한 습득물" onPress={() => router.push('/registered-item')}>
          {previewActivity.found}
        </Card>
      </ScrollView>
      <ActionBar>
        <ActionButton
          label="로그아웃"
          variant="outline"
          onPress={() => {
            setEditing(false);
            exitMemberPreview();
            router.replace('/home');
          }}
        />
      </ActionBar>
      <BottomNavigation selected="history" />
      {editing && (
        <ProfileModal
          profile={profile}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            updateProfile(next);
            setEditing(false);
          }}
        />
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  profile: { backgroundColor: colors.white, padding: 16, borderRadius: 12, gap: 8 },
});
