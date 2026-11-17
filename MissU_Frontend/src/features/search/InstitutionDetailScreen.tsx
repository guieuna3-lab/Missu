import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Header } from '@/components/Header';
import { Icon, type IconName } from '@/components/Icon';
import { ItemThumb } from '@/components/ItemThumb';
import { LineBadge, subwayStop } from '@/components/LineBadge';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import {
  institutionDetail,
  publicInstitutionPhotos,
  type InstitutionItem,
} from '@/lib/institutionItems';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
/** "2026-11-17" → "2026년 11월 17일" */
function longDate(date: string) {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : date;
}
/** "2026-11-17" → "11월 17일" */
const shortDate = (date: string) => longDate(date).replace(/^\d{4}년 /, '');
const seoulToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

function InfoRow({
  icon,
  label,
  value,
  sub,
  last = false,
}: {
  last?: boolean;
  icon: IconName;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View
      style={[styles.row, last && styles.rowLast]}
      accessible
      accessibilityLabel={[label, value, sub].filter(Boolean).join(', ')}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} tintColor={colors.body} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowValue}>{value}</Text>
        {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
    </View>
  );
}

function InstitutionPhotos({ item }: { item: InstitutionItem }) {
  const supplied = item.photoUrls;
  const police = item.id.startsWith('lost112:');
  const [lookup, setLookup] = useState(police && !supplied?.length);
  const [publicUrls, setPublicUrls] = useState<string[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(0);
  // Screen은 최대 600pt 폭이라 그 안에서 꽉 차게 맞춥니다.
  const width = Math.min(useWindowDimensions().width, 600);
  useEffect(() => {
    if (!lookup) return;
    const controller = new AbortController();
    void publicInstitutionPhotos(item.id, controller.signal).then(
      (urls) => {
        if (!controller.signal.aborted) setPublicUrls(urls);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [lookup, item.id, attempt]);

  const urls = lookup ? publicUrls : supplied;
  if (!urls?.length && !failed) return null;
  function onError() {
    // 예전 공공데이터 사진 주소가 만료됐으면 같은 물품의 경찰민원24 첨부를 다시 확인합니다.
    if (police && !lookup) setLookup(true);
    else setFailed(true);
  }
  const count = urls?.length ?? 0;
  return (
    <View style={count > 0 && styles.photos}>
      {/* 화면 가로폭을 꽉 채우고, 여러 장이면 옆으로 넘깁니다. */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {urls?.map((uri, i) => (
          <Image
            key={uri + ':' + attempt}
            source={{ uri }}
            resizeMode="cover"
            accessibilityLabel={item.name + ' 사진 ' + (i + 1)}
            style={{ width, height: Math.round(width * 0.75) }}
            onError={onError}
          />
        ))}
      </ScrollView>
      {count > 1 && (
        <View style={styles.pageBadge} accessibilityLabel={`사진 ${page + 1} / ${count}`}>
          <Text style={styles.pageText}>{`${page + 1} / ${count}`}</Text>
        </View>
      )}
      {failed && (
        <ActionButton
          label="기관 사진 다시 불러오기"
          variant="outline"
          style={styles.photoRetry}
          onPress={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        />
      )}
    </View>
  );
}
export function InstitutionDetailScreen({ id }: { id: string }) {
  const [item, setItem] = useState<InstitutionItem>();
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [attempt, retry] = useState(0);
  const [today] = useState(seoulToday);
  useEffect(() => {
    let active = true;
    void institutionDetail(id).then(
      (i) => {
        if (active) setItem(i);
      },
      (e) => {
        if (active) setError(e instanceof Error ? e.message : '상세를 불러오지 못했어요.');
      },
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);
  function open(url: string) {
    setLinkError('');
    void Linking.openURL(url).catch(() =>
      setLinkError('이 기기에서 링크를 열 수 없어요. 표시된 보관처와 관리번호를 확인해 주세요.'),
    );
  }
  const stop = item ? subwayStop(item.source, item.storage) : null;
  const call = item?.phone
    ? () => open('tel:' + item.phone!.replace(/[^0-9]/g, ''))
    : item
      ? () => open('https://map.kakao.com/link/search/' + encodeURIComponent(item.storage))
      : undefined;
  return (
    <Screen>
      <Header title="기관 습득물 상세" onBack={back} />
      <ScrollView contentContainerStyle={item ? undefined : styles.content}>
        {error ? (
          <>
            <Text accessibilityRole="alert">{error}</Text>
            <ActionButton
              label="다시 확인"
              onPress={() => {
                setError('');
                retry((n) => n + 1);
              }}
            />
          </>
        ) : !item ? (
          <Text>기관의 보관 정보를 확인하고 있어요.</Text>
        ) : (
          <>
            <View style={styles.hero}>
              {/* 기관이 공개한 사진이 있으면 첫 장을, 없으면 종류 아이콘을 보여줍니다. */}
              <ItemThumb
                name={item.name}
                category={item.category}
                photoUrl={item.photoUrls?.[0]}
                size={56}
              />
              <View style={styles.heroText}>
                <Text accessibilityRole="header" style={styles.title}>
                  {item.name}
                </Text>
                <View style={styles.chips}>
                  <View style={[styles.chip, stop && styles.chipWithBadge]}>
                    {stop && <LineBadge line={stop.line} size={20} />}
                    <Text style={styles.chipText} numberOfLines={1}>
                      {(stop ? stop.station : item.storage) + ' 보관'}
                    </Text>
                  </View>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>
                      {item.source === '한성대' ? '한성대 · 학교 접수' : item.source + ' 습득물'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
            <InstitutionPhotos key={item.id} item={item} />
            <View style={styles.body}>
              <View style={styles.card}>
                <InfoRow
                  icon="info-date"
                  label={item.dateLabel}
                  value={longDate(item.date)}
                  sub={[
                    item.date === today ? '오늘' : '',
                    item.dateLabel === '게시일' ? '습득일 미공개' : '',
                    item.lastVerifiedOn ? '보관 확인 ' + shortDate(item.lastVerifiedOn) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
                {!!item.foundPlace && (
                  <InfoRow icon="info-place" label="습득 장소" value={item.foundPlace} />
                )}
                <InfoRow
                  icon="info-storage"
                  label="보관처"
                  value={item.storage}
                  sub={item.phone}
                  last
                />
              </View>
              <View style={styles.card}>
                <Text style={styles.refLabel}>관리번호 · 전화할 때 알려주세요</Text>
                <View style={styles.refBox}>
                  {/* 길게 눌러 복사할 수 있습니다. 클립보드 패키지는 추가하지 않았습니다. */}
                  <Text selectable style={styles.refNumber}>
                    {item.reference}
                  </Text>
                </View>
              </View>
              <View style={styles.guide}>
                <Text style={styles.guideTitle}>방문 전에 확인하세요</Text>
                {[
                  '보관처에 전화해 물품명과 관리번호를 알려 주세요.',
                  '현재 보관 여부와 수령 방법을 확인해 주세요.',
                ].map((text, index) => (
                  <View key={text} style={styles.step}>
                    <View style={styles.stepNo}>
                      <Text style={styles.stepNoText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.stepText}>{text}</Text>
                  </View>
                ))}
              </View>
              {!!linkError && <Text accessibilityRole="alert">{linkError}</Text>}
            </View>
          </>
        )}
      </ScrollView>
      {item && (
        <View style={styles.bar}>
          <ActionButton
            label={item.phone ? '보관처에 전화하기 · ' + item.phone : '보관처 연락처 찾기'}
            onPress={call}
          />
        </View>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  photos: { backgroundColor: colors.ink },
  pageBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  pageText: { ...typography.label, fontSize: 12, lineHeight: 18, color: colors.white },
  photoRetry: { margin: 16 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  heroText: { flex: 1, gap: 8 },
  title: { ...typography.heading, fontSize: 21, lineHeight: 28 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#F2F4F6',
  },
  chipWithBadge: { paddingLeft: 5 },
  chipText: { ...typography.label, fontSize: 13, color: '#4E5968', flexShrink: 1 },
  body: { padding: 20, gap: 12 },
  // 카드 마지막 줄의 구분선은 겹쳐 보이지 않게 가립니다.
  card: {
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F4F6',
  },
  rowLabel: { ...typography.body, width: 64, color: colors.muted },
  rowBody: { flex: 1, gap: 1 },
  rowValue: { ...typography.label, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  rowSub: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  refLabel: { ...typography.body, color: colors.muted, marginTop: 12, marginBottom: 6 },
  refBox: { backgroundColor: colors.background, borderRadius: 12, padding: 14, marginBottom: 14 },
  refNumber: {
    ...typography.label,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  guide: { backgroundColor: colors.lightBlue, borderRadius: 16, padding: 18, gap: 8 },
  guideTitle: { ...typography.label, fontSize: 14, fontWeight: '700', color: colors.blue },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNo: {
    width: 21,
    height: 21,
    borderRadius: 11,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.blue,
  },
  stepNoText: {
    ...typography.label,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.white,
  },
  stepText: { ...typography.body, flex: 1, fontSize: 14, lineHeight: 22, color: '#334155' },
  bar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
