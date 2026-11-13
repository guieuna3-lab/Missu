import { router, useFocusEffect } from 'expo-router';
import { useState, useCallback } from 'react';
import { itemRepository, formatFoundAt, type PublicItem } from '@/lib/items';
import { recentInstitutions, openInstitution, type InstitutionItem } from '@/lib/institutionItems';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { previewActivity } from '@/lib/preview/fixtures';
import { isPreview } from '@/lib/preview/PreviewProvider';

type HomeItem = PublicItem | InstitutionItem;
// 기관 날짜의 정밀도는 일 단위입니다. 서울 날짜의 시작을 기준으로 회원 등록 시각과 비교합니다.
const recentTime = (item: HomeItem) =>
  Date.parse('source' in item ? item.date + 'T00:00:00+09:00' : (item.createdAt ?? item.foundAt));
export function HomeScreen() {
  const [recent, setRecent] = useState<HomeItem[]>([]);
  const [notice, setNotice] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setState('loading');
      setNotice('');
      const members = itemRepository.search({ query: '', place: '', period: 'all' });
      void members
        .then((items) => {
          if (active && items.length) {
            setRecent(items.slice(0, 3));
            setState('ready');
          }
        })
        .catch(() => {});
      void Promise.allSettled([members, recentInstitutions()]).then(([member, agency]) => {
        if (!active) return;
        const rows: HomeItem[] = [
          ...(member.status === 'fulfilled' ? member.value : []),
          ...(agency.status === 'fulfilled' ? agency.value.items : []),
        ];
        setRecent(
          rows
            .sort((a, b) => recentTime(b) - recentTime(a) || a.id.localeCompare(b.id))
            .slice(0, 3),
        );
        const messages =
          agency.status === 'fulfilled'
            ? agency.value.notices.filter((n) => n.includes('조회할 수 없어요'))
            : ['기관 자료를 불러오지 못했어요.'];
        if (member.status === 'rejected') messages.push('회원 자료를 불러오지 못했어요.');
        setNotice(messages.join(' '));
        setState(member.status === 'rejected' && agency.status === 'rejected' ? 'error' : 'ready');
      });
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <Screen>
      <Header />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={[typography.label, styles.white, { opacity: 0.7 }]}>분실물 찾기 서비스</Text>
          <Text accessibilityRole="header" style={[typography.heading, styles.white]}>
            {'잃어버린 물건,\n같이 찾아요'}
          </Text>
          <ActionButton
            label="습득물 검색하기"
            variant="white"
            style={{ marginTop: 8 }}
            onPress={() => router.push('/search')}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/nearby')}
          style={styles.nearby}
        >
          <Icon name="pin" />
          <View style={styles.itemText}>
            <Text style={typography.label}>내 근처 습득물</Text>
            {isPreview && <Text style={styles.secondary}>{previewActivity.nearby}</Text>}
          </View>
          <Text style={[typography.body, { color: colors.blue }]}>보기 →</Text>
        </Pressable>
        <Text style={[typography.label, styles.sectionTitle]}>이런 분들을 도와드려요</Text>
        <View style={styles.audience}>
          {(
            [
              { icon: 'heart', label: 'ADHD', width: 80 },
              { icon: 'child', label: '아이 물건', width: 100 },
              { icon: 'shield', label: '공개 정보 조회', width: 120 },
            ] as const
          ).map((chip) => (
            <View key={chip.icon} style={[styles.chip, { minWidth: chip.width }]}>
              <Icon name={chip.icon} />
              <Text style={[typography.label, { color: colors.body }]}>{chip.label}</Text>
            </View>
          ))}
        </View>
        <Text style={[typography.label, styles.sectionTitle, { marginTop: 20 }]}>
          최근 등록된 습득물
        </Text>
        <View style={styles.items}>
          {/* Figma 01.03-E: no recent items yet. */}
          {state === 'loading' && <Text style={styles.secondary}>최근 습득물을 불러오는 중…</Text>}
          {state === 'error' && (
            <Text style={styles.secondary}>최근 습득물을 불러오지 못했어요.</Text>
          )}
          {state === 'ready' && !recent.length && (
            <Text style={styles.secondary}>
              {notice ? '조회한 자료에 최근 습득물이 없어요.' : '최근 등록된 습득물이 없어요'}
            </Text>
          )}
          {state === 'ready' &&
            recent.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() =>
                  'source' in item
                    ? openInstitution(item)
                    : router.push({ pathname: '/items/[id]', params: { id: item.id } })
                }
                style={styles.item}
              >
                <Icon name="search" />
                <View style={styles.itemText}>
                  <Text style={typography.label}>{item.name}</Text>
                  <Text style={styles.secondary}>
                    {'source' in item
                      ? item.source + ' · ' + item.storage
                      : '회원 · ' + item.location}
                  </Text>
                  <Text style={styles.secondary}>
                    {'source' in item
                      ? item.dateLabel + ' ' + item.date
                      : item.createdAt
                        ? '등록일 ' + formatFoundAt(item.createdAt).slice(0, 10)
                        : '습득일 ' + formatFoundAt(item.foundAt).slice(0, 10)}
                  </Text>
                </View>
                <View style={styles.status}>
                  <Text style={[typography.label, { color: colors.green }]}>
                    {'source' in item ? '보관 중' : item.statusLabel}
                  </Text>
                </View>
              </Pressable>
            ))}
          {state === 'ready' && !!notice && <Text style={styles.secondary}>{notice}</Text>}
        </View>
      </ScrollView>
      <BottomNavigation selected="home" />
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  hero: { padding: 20, borderRadius: 20, backgroundColor: colors.blue, gap: 4 },
  white: { color: colors.white },
  nearby: {
    marginTop: 16,
    minHeight: 68,
    padding: 16,
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemText: { flex: 1, gap: 2 },
  secondary: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  sectionTitle: { color: colors.muted, marginTop: 16, marginBottom: 8 },
  audience: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  items: { gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  status: {
    minWidth: 58,
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenBg,
  },
});
