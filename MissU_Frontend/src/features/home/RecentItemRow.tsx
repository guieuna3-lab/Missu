import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';
import type { InstitutionItem } from '@/lib/institutionItems';
import type { PublicItem } from '@/lib/items';

export type HomeItem = PublicItem | InstitutionItem;

const KST_OFFSET_MS = 9 * 3_600_000;
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

// 홈 목록 표시 전용 분류입니다. 서버 분류(ELECTRONICS·WALLET_BAG·OTHER)가 거칠어서
// 물품명 키워드로 아이콘만 고릅니다. 검색·필터 값에는 쓰지 않습니다.
type Kind = 'electronics' | 'wallet' | 'card' | 'accessory' | 'key' | 'other';
const kinds: Record<Kind, { icon: IconName; tint: string; background: string }> = {
  electronics: { icon: 'cat-electronics', tint: '#2563EB', background: '#EAF2FF' },
  wallet: { icon: 'cat-wallet', tint: '#E5484D', background: '#FDEEEF' },
  card: { icon: 'cat-card', tint: '#12A150', background: '#E8F7EE' },
  accessory: { icon: 'cat-accessory', tint: '#D99A00', background: '#FFF6DB' },
  key: { icon: 'cat-key', tint: '#7C4DFF', background: '#F3EDFF' },
  other: { icon: 'cat-other', tint: '#6B7684', background: '#F1F3F5' },
};

function kindOf(item: HomeItem): Kind {
  const text = item.name;
  // 순서가 중요합니다: '카드지갑'은 지갑, '전자담배'는 전자기기가 아닙니다.
  if (/지갑|가방|백팩|파우치|쇼핑백/u.test(text)) return 'wallet';
  if (/카드|신분증|학생증|면허증|여권/u.test(text)) return 'card';
  if (/담배/u.test(text)) return 'other';
  if (/반지|목걸이|귀걸이|팔찌|시계|귀금속|안경|선글라스/u.test(text)) return 'accessory';
  if (/열쇠|키링|차키/u.test(text)) return 'key';
  if (
    /노트북|휴대폰|핸드폰|스마트폰|이어폰|버즈|에어팟|태블릿|아이패드|충전기|헤드폰|전자/u.test(
      text,
    )
  )
    return 'electronics';
  switch (item.category) {
    case 'ELECTRONICS':
      return 'electronics';
    case 'WALLET':
    case 'BAG':
    case 'WALLET_BAG':
      return 'wallet';
    case 'KEY':
      return 'key';
    case 'ID':
      return 'card';
    default:
      return 'other';
  }
}

// 서울 지하철 노선색입니다.
const lineColors: Record<string, string> = {
  '1': '#0052A4',
  '2': '#00A84D',
  '3': '#EF7C1C',
  '4': '#00A5DE',
  '5': '#996CAC',
  '6': '#CD7C2F',
  '7': '#747F00',
  '8': '#E6186C',
  '9': '#BDB092',
};

/** "혜화역(4호선)" → { line: '4', station: '혜화역' } */
function subwayStop(item: HomeItem) {
  if (!('source' in item) || item.source !== '지하철') return null;
  const m = item.storage.match(/^(.+?)\s*\((\d)호선\)$/u);
  return m && lineColors[m[2]] ? { station: m[1], line: m[2] } : null;
}

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

export function RecentItemRow({ item, onPress }: { item: HomeItem; onPress: () => void }) {
  // 화면을 연 시각 기준입니다. 렌더마다 바뀌지 않게 한 번만 읽습니다.
  const [now] = useState(Date.now);
  const kind = kinds[kindOf(item)];
  const stop = subwayStop(item);
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
      <View style={[styles.tile, { backgroundColor: kind.background }]}>
        <Icon name={kind.icon} size={24} tintColor={kind.tint} />
      </View>
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
          {stop && (
            <View style={[styles.line, { backgroundColor: lineColors[stop.line] }]}>
              <Text style={styles.lineText}>{stop.line}</Text>
            </View>
          )}
          <Text style={styles.metaText} numberOfLines={1}>
            {place}
            {!!when && <Text style={styles.dot}>{'  ·  '}</Text>}
            {when}
          </Text>
        </View>
        {!!owner && <Text style={styles.cta}>혹시 내 물건인가요? →</Text>}
      </View>
      <Text style={styles.chevron}>›</Text>
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
  tile: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
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
  line: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  lineText: {
    ...typography.label,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    color: colors.white,
  },
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
  day: { ...typography.label, color: colors.muted, marginTop: 4 },
  dayLead: { fontWeight: '700', color: colors.ink },
});
