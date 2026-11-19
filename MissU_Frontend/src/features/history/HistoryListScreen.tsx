import { useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConfirmDialog } from '@/components/Dialog';
import { FormMessage, TextLink } from '@/components/FormField';
import { requestErrorMessage } from '@/lib/mockRequest';
import { BottomNavigation } from '@/components/BottomNavigation';
import { ChoiceRow } from '@/components/ChoiceRow';
import { ItemThumb } from '@/components/ItemThumb';
import { ItemPhotoThumb } from '@/components/ItemPhotoThumb';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { LoginGateScreen } from '@/features/auth/LoginGateScreen';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { foundItemStatus } from '@/lib/activity/transitions';
import { categoryLabel, foundItemStatusLabel } from '@/lib/activity/types';
import { formatDate } from '@/lib/dateTime';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { receivedRequests, requestStatusLabel, sentRequests } from './activitySummary';

export type HistoryTab = 'lost' | 'requests' | 'found';

const tabs: { key: HistoryTab; label: string }[] = [
  { key: 'lost', label: '내 분실 신고' },
  { key: 'requests', label: '내 반환 요청' },
  { key: 'found', label: '등록한 습득물' },
];

type Selection = { id: string; name: string; type: 'lost' | 'found' };
export function HistoryListScreen() {
  const { profile, sessionId } = usePreview();
  return profile ? (
    <MemberHistoryList key={sessionId} memberName={profile.name} />
  ) : (
    <LoginGateScreen kind="history" />
  );
}

function MemberHistoryList({ memberName }: { memberName: string }) {
  const [selection, setSelection] = useState<Selection>();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const busy = useRef(false);
  const activity = useActivity();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: HistoryTab = tabs.some((t) => t.key === params.tab)
    ? (params.tab as HistoryTab)
    : 'lost';
  const listError =
    tab === 'found' ? activity.foundError : tab === 'lost' ? activity.reportsError : undefined;
  const loading =
    tab === 'found' ? activity.foundLoading : tab === 'lost' && activity.status === 'loading';

  async function remove() {
    if (!selection || busy.current) return;
    busy.current = true;
    setDeleting(true);
    setError(undefined);
    try {
      if (selection.type === 'lost') await activity.deleteLostReport(selection.id);
      else await activity.deleteFoundItem(selection.id);
    } catch (e) {
      setError(requestErrorMessage(e));
    } finally {
      busy.current = false;
      setDeleting(false);
      setSelection(undefined);
    }
  }

  const rows =
    tab === 'lost'
      ? activity.lostReports.map((report) => ({
          key: report.id,
          thumb: <ItemThumb name={report.name} category={report.category} size={40} />,
          title: report.name,
          description: `${categoryLabel(report.category)} · ${formatDate(report.lostFrom)}`,
          onPress: () => router.push({ pathname: '/my-reports/[id]', params: { id: report.id } }),
        }))
      : tab === 'requests'
        ? sentRequests(activity, memberName).map((request) => ({
            key: request.id,
            // 다른 목록과 같은 물품별 표시를 쓰고, 공개 사진이 있으면 먼저 보여줍니다.
            thumb: <ItemPhotoThumb id={request.itemId} name={request.itemName} size={40} />,
            title: request.itemName,
            description: `${requestStatusLabel[request.status]} · ${formatDate(request.createdAt)}`,
            onPress: () => router.push({ pathname: '/requests/[id]', params: { id: request.id } }),
          }))
        : activity.foundItems.map((item) => {
            const received = receivedRequests(activity).filter((r) => r.itemId === item.id);
            return {
              key: item.id,
              thumb: (
                <ItemPhotoThumb
                  id={item.id}
                  name={item.name}
                  category={item.category}
                  photoUrls={item.attachments?.map((photo) => photo.preview)}
                  size={40}
                />
              ),
              title: item.name,
              status:
                foundItemStatus(item, received) === 'returned'
                  ? foundItemStatusLabel.returned
                  : undefined,
              description: `${categoryLabel(item.category)} · 받은 요청 ${received.length}건`,
              onPress: () => router.push({ pathname: '/my-items/[id]', params: { id: item.id } }),
            };
          });

  return (
    <Screen>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={typography.heading}>
          내 활동 목록
        </Text>
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable
                key={t.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setError(undefined);
                  router.setParams({ tab: t.key });
                }}
                style={[styles.tab, active && styles.activeTab]}
              >
                <Text style={[styles.tabLabel, active && styles.activeTabLabel]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {error && <FormMessage>{error}</FormMessage>}
        {listError ? (
          <>
            <Text style={typography.body}>{listError}</Text>
            <TextLink
              label="다시 불러오기"
              onPress={tab === 'found' ? activity.retryFound : activity.retryReports}
            />
          </>
        ) : loading ? (
          <Text style={typography.body}>목록을 불러오고 있어요.</Text>
        ) : rows.length === 0 ? (
          <Text style={typography.body}>
            {tab === 'found'
              ? '등록한 습득물이 없어요.'
              : tab === 'lost'
                ? '등록한 분실 신고가 없어요.'
                : '보낸 반환 요청이 없어요.'}
          </Text>
        ) : (
          rows.map((row) => (
            <View style={styles.row} key={row.key}>
              <View style={styles.item}>
                <ChoiceRow
                  leading={row.thumb}
                  title={'status' in row && row.status ? row.title + ' · ' + row.status : row.title}
                  description={row.description}
                  onPress={row.onPress}
                />
              </View>
              {tab !== 'requests' && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={row.title + ' 삭제'}
                  style={styles.deleteButton}
                  onPress={() => {
                    setError(undefined);
                    setSelection({ id: row.key, name: row.title, type: tab });
                  }}
                >
                  <Text style={styles.deleteText}>삭제</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </ScrollView>
      <BottomNavigation selected="history" />
      {selection && (
        <ConfirmDialog
          title={selection.type === 'found' ? '습득물 글을 삭제할까요?' : '분실 신고를 삭제할까요?'}
          message={
            '‘' +
            selection.name +
            '’ 글을 삭제합니다.' +
            (selection.type === 'found' ? ' 승인 대기 중인 반환 요청이 있으면 함께 종료돼요.' : '')
          }
          confirmLabel="삭제"
          loading={deleting}
          onCancel={() => {
            if (!busy.current) setSelection(undefined);
          }}
          onConfirm={remove}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  item: { flex: 1, minWidth: 0 },
  deleteButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  deleteText: { ...typography.label, color: colors.danger },
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 12 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.blue,
    backgroundColor: colors.white,
  },
  activeTab: { backgroundColor: colors.blue },
  tabLabel: { ...typography.label, fontSize: 12, lineHeight: 18, color: colors.blue },
  activeTabLabel: { color: colors.white, fontWeight: '700' },
});
