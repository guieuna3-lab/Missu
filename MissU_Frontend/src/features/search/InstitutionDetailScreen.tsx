import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Header } from '@/components/Header';
import { InfoCard, InfoRow, StepGuide } from '@/components/InfoList';
import { ItemPhotoThumb } from '@/components/ItemPhotoThumb';
import { ItemPhotoGallery } from '@/components/ItemPhotoGallery';
import { LineBadge, subwayStop } from '@/components/LineBadge';
import { LoadingState } from '@/components/LoadingState';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { institutionDetail, type InstitutionItem } from '@/lib/institutionItems';

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
      <ScrollView contentContainerStyle={item ? undefined : !error ? styles.fill : styles.content}>
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
          <LoadingState
            title="보관 정보를 확인하고 있어요"
            description={'기관에 직접 조회하고 있어서\n몇 초 걸릴 수 있어요'}
          />
        ) : (
          <>
            <View style={styles.hero}>
              {/* 기관이 공개한 사진이 있으면 첫 장을, 없으면 종류 아이콘을 보여줍니다. */}
              <ItemPhotoThumb
                id={item.id}
                name={item.name}
                category={item.category}
                photoUrls={item.photoUrls}
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
            <ItemPhotoGallery
              id={item.id}
              name={item.name}
              category={item.category}
              photoUrls={item.photoUrls}
            />
            <View style={styles.body}>
              <InfoCard>
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
              </InfoCard>
              <View style={styles.card}>
                <Text style={styles.refLabel}>관리번호 · 전화할 때 알려주세요</Text>
                <View style={styles.refBox}>
                  {/* 길게 눌러 복사할 수 있습니다. 클립보드 패키지는 추가하지 않았습니다. */}
                  <Text selectable style={styles.refNumber}>
                    {item.reference}
                  </Text>
                </View>
              </View>
              <StepGuide
                title="방문 전에 확인하세요"
                steps={[
                  '보관처에 전화해 물품명과 관리번호를 알려 주세요.',
                  '현재 보관 여부와 수령 방법을 확인해 주세요.',
                ]}
              />
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
  fill: { flexGrow: 1 },
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
  refLabel: { ...typography.body, color: colors.muted, marginTop: 12, marginBottom: 6 },
  refBox: { backgroundColor: colors.background, borderRadius: 12, padding: 14, marginBottom: 14 },
  refNumber: {
    ...typography.label,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  bar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
