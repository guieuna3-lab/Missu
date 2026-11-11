import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionBar, ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { LoginGateScreen } from '@/features/auth/LoginGateScreen';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { receivedRequests, sentRequests } from './activitySummary';
import type { HistoryTab } from './HistoryListScreen';
import { ProfileModal } from './ProfileModal';

// Figma 01.05 with its loading (01.05-L), empty (01.05-E) and logout confirmation (01.05-C)
// states. A card with two or more entries opens the 01.09 list.
export function HistoryScreen() {
  const { profile, updateProfile, exitMemberPreview } = usePreview();
  const activity = useActivity();
  const [editing, setEditing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  if (!profile) return <LoginGateScreen kind="history" />;

  const reports = activity.lostReports;
  const sent = sentRequests(activity, profile.name);
  const items = activity.foundItems;
  const empty = reports.length + sent.length + items.length === 0;
  const openList = (tab: HistoryTab) => router.push({ pathname: '/history/list', params: { tab } });
  const plural = (name: string, count: number) => (count > 1 ? `${name} 외 ${count - 1}건` : name);

  function logout() {
    setLoggingOut(false);
    setEditing(false);
    exitMemberPreview();
    router.replace('/home');
  }

  return (
    <Screen>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        {activity.status === 'loading' ? (
          <>
            <Text accessibilityRole="header" style={typography.heading}>
              내 활동을 불러오고 있어요
            </Text>
            {[0, 1].map((index) => (
              <View key={index} style={styles.skeleton} accessibilityLabel="불러오는 중">
                <Text style={typography.label}>불러오는 중</Text>
                <View style={styles.bar} />
                <View style={[styles.bar, styles.shortBar]} />
              </View>
            ))}
          </>
        ) : empty ? (
          <>
            <Text accessibilityRole="header" style={typography.heading}>
              아직 활동 내역이 없어요
            </Text>
            <Text style={typography.body}>신고하거나 반환을 요청한 물품이 여기에 표시됩니다.</Text>
            <ActionButton label="분실 신고하기" onPress={() => router.replace('/report')} />
            <ActionButton
              label="습득물 검색하기"
              variant="outline"
              onPress={() => router.push('/search')}
              style={styles.blueOutline}
            />
          </>
        ) : (
          <>
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
            <Card
              title="내 분실 신고"
              disabled={reports.length === 0}
              onPress={
                reports.length === 1
                  ? () =>
                      router.push({ pathname: '/my-reports/[id]', params: { id: reports[0].id } })
                  : () => openList('lost')
              }
            >
              {reports.length
                ? `${plural(reports[0].name, reports.length)} · 신고됨`
                : '신고한 물품이 없어요'}
            </Card>
            <Card
              title="내 반환 요청"
              disabled={sent.length === 0}
              onPress={
                sent.length === 1
                  ? () => router.push({ pathname: '/requests/[id]', params: { id: sent[0].id } })
                  : () => openList('requests')
              }
            >
              {sent.length
                ? `${plural(sent[0].itemName, sent.length)} · 진행 상태 보기`
                : '진행 중인 반환 요청이 없어요'}
            </Card>
            <Card
              title="내가 등록한 습득물"
              disabled={items.length === 0}
              onPress={
                items.length === 1
                  ? () => router.push({ pathname: '/my-items/[id]', params: { id: items[0].id } })
                  : () => openList('found')
              }
            >
              {items.length
                ? `${plural(items[0].name, items.length)} · 받은 요청 ${
                    receivedRequests(activity).filter((r) => r.itemId === items[0].id).length
                  }건`
                : '등록한 물품이 없어요'}
            </Card>
          </>
        )}
      </ScrollView>
      <ActionBar>
        <ActionButton label="로그아웃" variant="outline" onPress={() => setLoggingOut(true)} />
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
      {loggingOut && (
        <ConfirmDialog
          title="로그아웃할까요?"
          message="다시 로그인하면 내 활동을 확인할 수 있어요."
          onCancel={() => setLoggingOut(false)}
          onConfirm={logout}
        />
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  profile: { backgroundColor: colors.white, padding: 16, borderRadius: 12, gap: 8 },
  skeleton: { gap: 12, paddingVertical: 8 },
  bar: { height: 16, borderRadius: 8, backgroundColor: colors.border, opacity: 0.6 },
  shortBar: { width: '70%' },
  blueOutline: { borderColor: colors.blue },
});
