import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/constants/theme';

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
/** 서울 날짜 "YYYY-MM-DD" */
export const seoulDate = (ms = Date.now()) =>
  new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * 시작일·끝일을 차례로 눌러 고르는 달력. min~max 밖 날짜는 고를 수 없습니다.
 * 끝일보다 앞을 누르면 그 날을 새 시작일로 봅니다.
 */
export function RangeCalendar({
  from,
  to,
  min,
  max,
  onChange,
}: {
  from?: string;
  to?: string;
  min: string;
  max: string;
  onChange: (range: { from?: string; to?: string }) => void;
}) {
  const anchor = (to ?? from ?? max).split('-').map(Number);
  const [month, setMonth] = useState({ y: anchor[0], m: anchor[1] });
  const first = new Date(Date.UTC(month.y, month.m - 1, 1));
  const days = new Date(Date.UTC(month.y, month.m, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array<null>(first.getUTCDay()).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  const minMonth = min.slice(0, 7);
  const maxMonth = max.slice(0, 7);
  const current = ymd(month.y, month.m, 1).slice(0, 7);
  function shift(delta: number) {
    const d = new Date(Date.UTC(month.y, month.m - 1 + delta, 1));
    setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
  }
  function pick(day: string) {
    if (!from || to || day < from) onChange({ from: day, to: undefined });
    else onChange({ from, to: day });
  }
  return (
    <View>
      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="이전 달"
          disabled={current <= minMonth}
          onPress={() => shift(-1)}
          hitSlop={10}
        >
          <Text style={[styles.arrow, current <= minMonth && styles.off]}>‹</Text>
        </Pressable>
        <Text style={styles.month}>{`${month.y}년 ${month.m}월`}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다음 달"
          disabled={current >= maxMonth}
          onPress={() => shift(1)}
          hitSlop={10}
        >
          <Text style={[styles.arrow, current >= maxMonth && styles.off]}>›</Text>
        </Pressable>
      </View>
      <View style={styles.grid}>
        {weekdays.map((w) => (
          <Text key={w} style={[styles.cell, styles.weekday]}>
            {w}
          </Text>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <View key={'e' + i} style={styles.cell} />;
          const day = ymd(month.y, month.m, d);
          const disabled = day < min || day > max;
          const isStart = day === from;
          const isEnd = day === to;
          const inside = !!from && !!to && day > from && day < to;
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={`${month.m}월 ${d}일${isStart ? ', 시작일' : ''}${isEnd ? ', 끝일' : ''}`}
              accessibilityState={{ disabled, selected: isStart || isEnd }}
              disabled={disabled}
              onPress={() => pick(day)}
              style={[
                styles.cell,
                inside && styles.inside,
                isStart && styles.start,
                isEnd && styles.end,
                isStart && isEnd && styles.single,
                isStart && !to && styles.single,
              ]}
            >
              <Text
                style={[
                  styles.day,
                  disabled && styles.off,
                  inside && styles.insideText,
                  (isStart || isEnd) && styles.picked,
                ]}
              >
                {d}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  month: { ...typography.label, fontSize: 16, fontWeight: '700' },
  arrow: { fontSize: 24, lineHeight: 26, color: colors.body },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    height: 40,
    marginVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekday: {
    ...typography.body,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 40,
    color: colors.muted,
  },
  day: { ...typography.label, fontSize: 14 },
  off: { color: colors.divider },
  inside: { backgroundColor: colors.lightBlue },
  insideText: { color: colors.blue },
  start: { backgroundColor: colors.blue, borderTopLeftRadius: 20, borderBottomLeftRadius: 20 },
  end: { backgroundColor: colors.blue, borderTopRightRadius: 20, borderBottomRightRadius: 20 },
  single: { borderRadius: 20 },
  picked: { color: colors.white, fontWeight: '700' },
});
