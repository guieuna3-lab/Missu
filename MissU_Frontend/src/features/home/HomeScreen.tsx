import { router, useFocusEffect } from 'expo-router';
import { useState, useCallback, useRef } from 'react';
import { cachedRecentResults, recentResults } from '@/lib/searchResults';
import { openInstitution } from '@/lib/institutionItems';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { DayHeading, RecentItemRow, dayKey, type HomeItem } from '@/components/ItemRow';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { previewActivity } from '@/lib/preview/fixtures';
import { isPreview } from '@/lib/preview/PreviewProvider';

const pageSize = 10;
// 기관 날짜의 정밀도는 일 단위입니다. 서울 날짜의 시작을 기준으로 회원 등록 시각과 비교합니다.
const recentTime = (item: HomeItem) =>
  Date.parse('source' in item ? item.date + 'T00:00:00+09:00' : (item.createdAt ?? item.foundAt));
export function HomeScreen() {
  const [initialPage] = useState(cachedRecentResults);
  const [retry, setRetry] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [recent, setRecent] = useState<HomeItem[]>(initialPage?.items ?? []);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [cursor, setCursor] = useState<string | null | undefined>(initialPage?.nextCursor);
  const [moreStatus, setMoreStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const generation = useRef(0);
  const fetchingMore = useRef(false);
  const [notice, setNotice] = useState(initialPage?.notices?.join(' ') ?? '');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(
    initialPage ? 'ready' : 'loading',
  );
  useFocusEffect(
    useCallback(() => {
      const current = ++generation.current;
      setRefreshing(true);
      fetchingMore.current = false;
      setVisibleCount(pageSize);
      const saved = retry ? undefined : cachedRecentResults();
      setRecent(saved?.items ?? []);
      setCursor(saved?.nextCursor);
      setMoreStatus('idle');
      setState(saved ? 'ready' : 'loading');
      setNotice(saved?.notices?.join(' ') ?? '');
      // 저장된 세 출처를 서버에서 함께 정렬한 결과만 한 번에 표시합니다.
      // 학교·공공포털의 새 자료 수집은 서버 뒤에서 이어집니다.
      void recentResults()
        .then((page) => {
          if (current !== generation.current) return;
          setRecent(page.items);
          setCursor(page.nextCursor);
          setNotice(page.notices?.join(' ') ?? '');
          setState('ready');
        })
        .catch(() => {
          if (current !== generation.current) return;
          if (saved) setNotice('새 목록을 불러오지 못해 마지막 확인 목록을 표시하고 있어요.');
          else setState('error');
        })
        .finally(() => {
          if (current === generation.current) setRefreshing(false);
        });
      return () => {
        generation.current++;
      };
    }, [retry]),
  );

  async function showMore() {
    if (refreshing || fetchingMore.current || cursor === undefined) return;
    if (visibleCount + pageSize <= recent.length || !cursor) {
      setVisibleCount((count) => Math.min(count + pageSize, recent.length));
      return;
    }
    const current = generation.current;
    fetchingMore.current = true;
    setMoreStatus('loading');
    try {
      const page = await recentResults(cursor);
      if (current !== generation.current) return;
      setRecent((rows) => [
        ...new Map([...rows, ...page.items].map((item) => [item.id, item])).values(),
      ]);
      setCursor(page.nextCursor);
      setVisibleCount((count) => count + pageSize);
      setNotice(page.notices?.join(' ') ?? '');
      setMoreStatus('idle');
    } catch {
      if (current === generation.current) setMoreStatus('error');
    } finally {
      if (current === generation.current) fetchingMore.current = false;
    }
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
        <Text style={[typography.label, styles.sectionTitle, { marginTop: 20 }]}>
          최근 등록된 습득물
        </Text>
        <View style={styles.items}>
          {/* Figma 01.03-E: no recent items yet. */}
          {state === 'loading' && <Text style={styles.secondary}>최근 습득물을 불러오는 중…</Text>}
          {state === 'error' && (
            <View style={styles.items}>
              <Text style={styles.secondary}>최근 습득물을 불러오지 못했어요.</Text>
              <ActionButton
                label="다시 시도"
                variant="outline"
                onPress={() => setRetry((value) => value + 1)}
              />
            </View>
          )}
          {state === 'ready' && !recent.length && (
            <Text style={styles.secondary}>현재 확인된 최근 습득물이 없어요.</Text>
          )}
          {state === 'ready' &&
            recent.slice(0, visibleCount).map((item, index, shown) => {
              const time = recentTime(item);
              const newDay = index === 0 || dayKey(time) !== dayKey(recentTime(shown[index - 1]));
              return (
                <View key={item.id} style={styles.items}>
                  {newDay && <DayHeading time={time} />}
                  <RecentItemRow
                    item={item}
                    onPress={() =>
                      'source' in item
                        ? openInstitution(item)
                        : router.push({ pathname: '/items/[id]', params: { id: item.id } })
                    }
                  />
                </View>
              );
            })}
          {state === 'ready' &&
            cursor !== undefined &&
            (recent.length > visibleCount || !!cursor) && (
              <ActionButton
                label={
                  moreStatus === 'loading'
                    ? '불러오는 중…'
                    : moreStatus === 'error'
                      ? '다시 시도'
                      : '더보기'
                }
                variant="outline"
                disabled={refreshing}
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
  items: { gap: 8 },
});
