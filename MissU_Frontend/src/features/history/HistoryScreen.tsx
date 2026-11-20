import { api } from '@/lib/backend';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionBar, ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Card } from '@/components/Card';
import { ConfirmDialog } from '@/components/Dialog';
import { TextLink } from '@/components/FormField';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { LoginGateScreen } from '@/features/auth/LoginGateScreen';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { receivedRequests, sentRequests } from './activitySummary';
import type { HistoryTab } from './HistoryListScreen';
import { ActivityRow } from './ActivityRow';
import { ProfileModal } from './ProfileModal';

// Figma 01.05 with its loading (01.05-L), empty (01.05-E), logout confirmation (01.05-C)
// and session-expired (01.04-S) states.
export function HistoryScreen() {
  const {
    profile,
    accessToken,
    sessionExpired,
    updateProfile,
    exitMemberPreview,
    startLogin,
    sessionNotice,
    retrySession,
  } = usePreview();
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
        <View style={styles.profile}>
          <Text style={typography.label}>나의 프로필</Text>
          <Text style={typography.body}>
            {profile.name} · {profile.email}
          </Text>
          <TextLink label="정보 수정" onPress={() => setEditing(true)} />
          <TextLink label="계정 관리" onPress={() => router.push('/account')} />
          <TextLink label="비슷한 습득물 알림" onPress={() => router.push('/notifications')} />
        </View>
        {!!sessionNotice && (
          <Card title={sessionNotice} onPress={retrySession}>
            다시 확인하기
          </Card>
        )}
        {activity.requestsError && (
          <Card title={activity.requestsError} onPress={activity.retryRequests}>
            다시 불러오기
          </Card>
        )}
        {activity.reportsError && (
          <Card title={activity.reportsError} onPress={activity.retryReports}>
            다시 불러오기
          </Card>
        )}
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
        ) : (
          <>
            <Text accessibilityRole="header" style={typography.heading}>
              {empty &&
              !activity.foundError &&
              !activity.foundLoading &&
              !activity.reportsError &&
              !activity.requestsError &&
              !activity.requestsLoading
                ? '아직 활동 내역이 없어요'
                : '내 활동'}
            </Text>
            <ActivityRow
              icon="edit"
              tint="#FFF4E5"
              title="내 분실 신고"
              count={activity.reportsError ? undefined : reports.length}
              description={
                reports.length
                  ? `${plural(reports[0].name, reports.length)} · 신고됨`
                  : '신고한 물품이 없어요'
              }
              onPress={() => openList('lost')}
            />
            {/* Always opens the list, like the other two rows, so past requests stay reachable. */}
            <ActivityRow
              icon="search"
              tint={colors.lightBlue}
              title="내 반환 요청"
              count={activity.requestsError || activity.requestsLoading ? undefined : sent.length}
              description={
                sent.length
                  ? `${plural(sent[0].itemName, sent.length)} · 진행 상태 보기`
                  : activity.requestsError ||
                    (activity.requestsLoading
                      ? '반환 요청을 불러오고 있어요'
                      : '보낸 반환 요청이 없어요')
              }
              onPress={() => openList('requests')}
            />
            <ActivityRow
              icon="box"
              tint="#ECFDF3"
              title="내가 등록한 습득물"
              count={activity.foundError || activity.foundLoading ? undefined : items.length}
              description={
                items.length
                  ? `${plural(items[0].name, items.length)} · 받은 요청 ${
                      receivedRequests(activity).filter((r) => r.itemId === items[0].id).length
                    }건`
                  : activity.foundError ||
                    (activity.foundLoading
                      ? '등록한 물품을 불러오고 있어요'
                      : '등록한 물품이 없어요')
              }
              onPress={() => openList('found')}
            />
            {empty && (
              <>
                <ActionButton label="분실 신고하기" onPress={() => router.replace('/report')} />
                <ActionButton
                  label="습득물 검색하기"
                  variant="outline"
                  onPress={() => router.push('/search')}
                  style={styles.blueOutline}
                />
              </>
            )}
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
          onSave={async (name) => {
            if (accessToken)
              await api('/me', {
                method: 'PATCH',
                headers: {
                  Authorization: 'Bearer ' + accessToken,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ nickname: name }),
              });
            updateProfile({ name, email: profile.email });
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
      {sessionExpired && (
        <ConfirmDialog
          title="로그인이 만료되었어요"
          message="다시 로그인하면 이용하던 화면으로 돌아갈 수 있어요."
          confirmLabel="다시 로그인"
          onConfirm={() => {
            exitMemberPreview();
            startLogin('mine');
          }}
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
