import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TextLink } from '@/components/FormField';
import { BottomNavigation } from '@/components/BottomNavigation';
import { ChoiceRow } from '@/components/ChoiceRow';
import { Header } from '@/components/Header';
import type { IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { LoginGateScreen } from '@/features/auth/LoginGateScreen';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { categoryLabel, type ItemCategory } from '@/lib/activity/types';
import { formatDate } from '@/lib/dateTime';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { receivedRequests, requestStatusLabel, sentRequests } from './activitySummary';

export type HistoryTab = 'lost' | 'requests' | 'found';

const tabs: { key: HistoryTab; label: string }[] = [
  { key: 'lost', label: '내 분실 신고' },
  { key: 'requests', label: '내 반환 요청' },
  { key: 'found', label: '등록한 습득물' },
];

const categoryIcons: Record<ItemCategory, IconName> = {
  ELECTRONICS: 'buds',
  WALLET: 'wallet',
  BAG: 'bag',
  KEY: 'key',
  ID: 'id',
  OTHER: 'box',
};

// Figma 01.09: the list behind a 01.05 card that has two or more entries.
export function HistoryListScreen() {
  const { profile } = usePreview();
  const activity = useActivity();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: HistoryTab = tabs.some((t) => t.key === params.tab)
    ? (params.tab as HistoryTab)
    : 'lost';
  if (!profile) return <LoginGateScreen kind="history" />;

  const rows =
    tab === 'lost'
      ? activity.lostReports.map((report) => ({
          key: report.id,
          icon: categoryIcons[report.category],
          title: report.name,
          description: `${categoryLabel(report.category)} · ${formatDate(report.lostFrom)}`,
          onPress: () => router.push({ pathname: '/my-reports/[id]', params: { id: report.id } }),
        }))
      : tab === 'requests'
        ? sentRequests(activity, profile.name).map((request) => ({
            key: request.id,
            icon: 'search' as IconName,
            title: request.itemName,
            description: `${requestStatusLabel[request.status]} · ${formatDate(request.createdAt)}`,
            onPress: () => router.push({ pathname: '/requests/[id]', params: { id: request.id } }),
          }))
        : activity.foundItems.map((item) => {
            const received = receivedRequests(activity).filter((r) => r.itemId === item.id);
            return {
              key: item.id,
              icon: categoryIcons[item.category],
              title: item.name,
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
                onPress={() => router.setParams({ tab: t.key })}
                style={[styles.tab, active && styles.activeTab]}
              >
                <Text style={[styles.tabLabel, active && styles.activeTabLabel]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {tab === 'lost' && activity.reportsError ? (
          <>
            <Text style={typography.body}>{activity.reportsError}</Text>
            <TextLink label="다시 불러오기" onPress={activity.retryReports} />
          </>
        ) : tab === 'lost' && activity.status === 'loading' ? (
          <Text style={typography.body}>분실 신고를 불러오고 있어요.</Text>
        ) : rows.length === 0 ? (
          <Text style={typography.body}>아직 표시할 항목이 없어요.</Text>
        ) : (
          rows.map((row) => (
            <ChoiceRow
              key={row.key}
              icon={row.icon}
              title={row.title}
              description={row.description}
              onPress={row.onPress}
            />
          ))
        )}
      </ScrollView>
      <BottomNavigation selected="history" />
    </Screen>
  );
}

const styles = StyleSheet.create({
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
