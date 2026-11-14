import { router, useFocusEffect } from 'expo-router';
import { useState, useCallback, useRef } from 'react';
import { itemRepository, formatFoundAt, type PublicItem } from '@/lib/items';
import {
  recentInstitutions,
  previewInstitutions,
  openInstitution,
  type InstitutionItem,
} from '@/lib/institutionItems';
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
const pageSize = 10;
// 기관 날짜의 정밀도는 일 단위입니다. 서울 날짜의 시작을 기준으로 회원 등록 시각과 비교합니다.
const recentTime = (item: HomeItem) =>
  Date.parse('source' in item ? item.date + 'T00:00:00+09:00' : (item.createdAt ?? item.foundAt));
const newestFirst = (a: HomeItem, b: HomeItem) =>
  recentTime(b) - recentTime(a) || b.id.localeCompare(a.id);
export function HomeScreen() {
  const [recent, setRecent] = useState<HomeItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [cursor, setCursor] = useState<string | null>();
  const [agencyCursor, setAgencyCursor] = useState<string | null>(null);
  const [moreStatus, setMoreStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const generation = useRef(0);
  const fetchingMore = useRef(false);
  const [notice, setNotice] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useFocusEffect(
    useCallback(() => {
      const current = ++generation.current;
      fetchingMore.current = false;
      setVisibleCount(pageSize);
      setCursor(undefined);
      setAgencyCursor(null);
      setMoreStatus('idle');
      setState('loading');
      setNotice('');
      const members = itemRepository.recentPage();
      let complete = false;
      const firstRows: HomeItem[] = [];
      function showFirst(items: HomeItem[]) {
        if (complete || current !== generation.current || !items.length) return;
        firstRows.push(...items);
        setRecent([...firstRows].sort(newestFirst));
        setState('ready');
        setNotice('다른 기관의 보관품도 확인하고 있어요.');
      }
      void members.then(({ items }) => showFirst(items)).catch(() => {});
      void previewInstitutions()
        .then(({ items }) => showFirst(items))
        .catch(() => {});
      void Promise.allSettled([members, recentInstitutions()]).then(([member, agency]) => {
        if (current !== generation.current) return;
        complete = true;
        const rows: HomeItem[] = [
          ...(member.status === 'fulfilled' ? member.value.items : []),
          ...(agency.status === 'fulfilled' ? agency.value.items : []),
        ];
        setRecent(rows.sort(newestFirst));
        setCursor(member.status === 'fulfilled' ? member.value.nextCursor : null);
        setAgencyCursor(agency.status === 'fulfilled' ? agency.value.nextCursor : null);
        const messages =
          agency.status === 'fulfilled'
            ? agency.value.notices.filter((n) => n.includes('조회할 수 없어요'))
            : ['기관 자료를 불러오지 못했어요.'];
        if (member.status === 'rejected') messages.push('회원 자료를 불러오지 못했어요.');
        setNotice(messages.join(' '));
        setState(member.status === 'rejected' && agency.status === 'rejected' ? 'error' : 'ready');
      });
      return () => {
        generation.current++;
      };
    }, []),
  );

  async function showMore() {
    if (fetchingMore.current || cursor === undefined) return;
    const nextCount = visibleCount + pageSize;
    const memberCount = recent.filter((item) => !('source' in item)).length;
    // 마지막 회원 페이지보다 오래된 기관 카드가 먼저 펼쳐지지 않게 합니다.
    const loadMembers = !!cursor && nextCount > memberCount;
    const loadAgencies = !!agencyCursor && nextCount > recent.length - memberCount;
    if (loadMembers || loadAgencies) {
      const current = generation.current;
      fetchingMore.current = true;
      setMoreStatus('loading');
      try {
        const [members, agencies] = await Promise.all([
          loadMembers ? itemRepository.recentPage(cursor!) : undefined,
          loadAgencies ? recentInstitutions(agencyCursor!) : undefined,
        ]);
        if (current !== generation.current) return;
        const rows = new Map(recent.map((item) => [item.id, item]));
        for (const item of [...(members?.items ?? []), ...(agencies?.items ?? [])])
          rows.set(item.id, item);
        // 다음 기관 페이지에도 더 최근 물품이 있어, 표시 중인 카드까지 함께 정렬합니다.
        setRecent([...rows.values()].sort(newestFirst));
        if (members) setCursor(members.nextCursor);
        if (agencies) {
          setAgencyCursor(agencies.nextCursor);
          const issues = agencies.notices.filter((s) => s.includes('현재 조회'));
          if (issues.length) setNotice(issues.join(' '));
        }
        setMoreStatus('idle');
      } catch {
        if (current === generation.current) setMoreStatus('error');
        return;
      } finally {
        if (current === generation.current) fetchingMore.current = false;
      }
    }
    setVisibleCount(Math.min(visibleCount, recent.length) + pageSize);
  }

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
            recent.slice(0, visibleCount).map((item) => (
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
                      ? item.dateLabel +
                        ' ' +
                        item.date +
                        (item.dateLabel === '게시일' ? ' · 습득일 미공개' : '')
                      : item.createdAt
                        ? '등록일 ' + formatFoundAt(item.createdAt).slice(0, 10)
                        : '습득일 ' + formatFoundAt(item.foundAt).slice(0, 10)}
                  </Text>
                </View>
                <View style={styles.status}>
                  <Text style={[typography.label, { color: colors.green }]}>
                    {'source' in item
                      ? item.lastVerifiedOn
                        ? '보관 확인 ' + item.lastVerifiedOn
                        : item.source === '한성대'
                          ? '학교 접수'
                          : '보관 중'
                      : item.statusLabel}
                  </Text>
                </View>
              </Pressable>
            ))}
          {state === 'ready' &&
            cursor !== undefined &&
            (recent.length > visibleCount || !!cursor || !!agencyCursor) && (
              <ActionButton
                label={
                  moreStatus === 'loading'
                    ? '불러오는 중…'
                    : moreStatus === 'error'
                      ? '다시 시도'
                      : '더보기'
                }
                variant="outline"
                onPress={moreStatus === 'loading' ? undefined : () => void showMore()}
              />
            )}
          {moreStatus === 'error' && (
            <Text style={styles.secondary}>다음 물품을 불러오지 못했어요.</Text>
          )}
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
