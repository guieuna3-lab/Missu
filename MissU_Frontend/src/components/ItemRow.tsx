import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ItemThumb } from '@/components/ItemThumb';
import { LineBadge, subwayStop } from '@/components/LineBadge';
import { formatDistance } from '@/lib/searchRank';
import { colors, typography } from '@/constants/theme';
import type { InstitutionItem } from '@/lib/institutionItems';
import type { PublicItem } from '@/lib/items';

export type HomeItem = PublicItem | InstitutionItem;

const KST_OFFSET_MS = 9 * 3_600_000;
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

/** 물품명 끝 괄호를 상태·이름 칩으로 분리합니다. "노트북(유실자 방문 예정)" → 노트북 + 방문 예정 */
function splitName(name: string) {
  const m = name.match(/^(.+?)\s*\(([^()]+)\)$/u);
  if (!m) return { title: name };
  if (/방문/u.test(m[2])) return { title: m[1], status: '방문 예정' };
  if (/\*/u.test(m[2])) return { title: m[1], owner: m[2] };
  return { title: name };
}

function seoulDay(time: number) {
  const d = new Date(time + KST_OFFSET_MS);
  return {
    key: d.toISOString().slice(0, 10),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

/** 날짜 그룹 키(서울 기준 YYYY-MM-DD) */
export const dayKey = (time: number) => seoulDay(time).key;

/** "오늘 · 11월 17일 (화)", "어제 · …", 그 밖에는 "11월 15일 (일)" */
export function dayHeading(time: number, now = Date.now()) {
  const d = seoulDay(time);
  const date = `${d.month}월 ${d.day}일 (${weekdays[d.weekday]})`;
  if (d.key === seoulDay(now).key) return { lead: '오늘', date };
  if (d.key === seoulDay(now - 86_400_000).key) return { lead: '어제', date };
  return { lead: '', date };
}

function relativeTime(iso: string, now: number) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes) || minutes < 0) return '';
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}시간 전`;
  return '';
}

export function RecentItemRow({
  item,
  onPress,
  distanceM,
}: {
  item: HomeItem;
  onPress: () => void;
  /** 가까운 순일 때 기준 장소와의 거리(m). 있으면 화살표 대신 거리를 보여줍니다. */
  distanceM?: number;
}) {
  // 화면을 연 시각 기준입니다. 렌더마다 바뀌지 않게 한 번만 읽습니다.
  const [now] = useState(Date.now);
  const stop = subwayStop('source' in item ? item.source : undefined, item.storage);
  const { title, status, owner } = splitName(item.name);
  const institution = 'source' in item ? item : null;
  const member = 'source' in item ? null : item;
  const place = stop
    ? stop.station
    : institution
      ? `${institution.source} · ${institution.storage}`
      : (member?.location ?? '');
  const when = institution
    ? institution.dateLabel === '게시일'
      ? '게시일 기준 · 습득일 미공개'
      : ''
    : member?.createdAt
      ? relativeTime(member.createdAt, now)
      : '';
  const badge = institution
    ? institution.source === '한성대'
      ? '학교 접수'
      : ''
    : member?.statusLabel;
  const label = [
    title,
    status,
    owner && `이름 ${owner}`,
    stop ? `${stop.line}호선 ${stop.station}` : place,
    when,
    badge,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} 상세 보기`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <ItemThumb
        name={item.name}
        category={item.category}
        photoUrl={'source' in item ? item.photoUrls?.[0] : item.photoUrl}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!!status && <Text style={[styles.chip, styles.visit]}>{status}</Text>}
          {!!owner && <Text style={[styles.chip, styles.owner]}>{owner}</Text>}
          {!!badge && <Text style={[styles.chip, styles.owner]}>{badge}</Text>}
        </View>
        <View style={styles.meta}>
          {stop && <LineBadge line={stop.line} />}
          <Text style={styles.metaText} numberOfLines={1}>
            {place}
            {!!when && <Text style={styles.dot}>{'  ·  '}</Text>}
            {when}
          </Text>
        </View>
        {!!owner && <Text style={styles.cta}>혹시 내 물건인가요? →</Text>}
      </View>
      {distanceM !== undefined ? (
        <Text style={styles.distance}>{formatDistance(distanceM)}</Text>
      ) : (
        <Text style={styles.chevron}>›</Text>
      )}
    </Pressable>
  );
}

export function DayHeading({ time }: { time: number }) {
  const [now] = useState(Date.now);
  const { lead, date } = dayHeading(time, now);
  return (
    <Text accessibilityRole="header" style={styles.day}>
      {!!lead && <Text style={styles.dayLead}>{lead + '  '}</Text>}
      {date}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 72,
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  pressed: { backgroundColor: colors.background },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...typography.label, fontSize: 15, lineHeight: 22, fontWeight: '700', flexShrink: 1 },
  chip: {
    ...typography.label,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  visit: { color: '#E8590C', backgroundColor: '#FFF1E6' },
  owner: { color: '#0E9F6E', backgroundColor: colors.greenBg },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    flexShrink: 1,
  },
  dot: { color: colors.divider },
  cta: { ...typography.label, fontSize: 12, lineHeight: 18, fontWeight: '700', color: colors.blue },
  chevron: { fontSize: 22, lineHeight: 24, color: colors.divider },
  distance: {
    ...typography.label,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.blue,
    backgroundColor: colors.lightBlue,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  day: { ...typography.label, color: colors.muted, marginTop: 4 },
  dayLead: { fontWeight: '700', color: colors.ink },
});
