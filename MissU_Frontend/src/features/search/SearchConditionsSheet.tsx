import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FormMessage } from '@/components/FormField';
import { Icon } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';
import { readDeviceLocation } from '@/features/nearby/deviceLocation';
import { PlaceSearchField } from '@/features/place/PlaceSearchField';
import type { SearchFilters } from '@/lib/items';
import { RangeCalendar, seoulDate } from './RangeCalendar';
import { SearchSheet } from './SearchSheet';

const periodOptions = [
  { value: '7', label: '최근 7일' },
  { value: '30', label: '최근 30일' },
  { value: 'all', label: '최근 6개월' },
  { value: 'custom', label: '직접 설정' },
] as const;

/** "2026-11-01" → "2026.11.01" */
const dotted = (day?: string) => (day ? day.replaceAll('-', '.') : '날짜 선택');
const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** 검색의 기간·장소 조건을 고르는 시트. 연 시점의 조건으로 시작해 적용할 때만 반영합니다. */
export function SearchConditionsSheet({
  value,
  onClose,
  onApply,
}: {
  value: SearchFilters;
  onClose: () => void;
  onApply: (next: SearchFilters) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [picking, setPicking] = useState<{ from?: string; to?: string } | null>(null);
  const [placeText, setPlaceText] = useState(value.near ? '' : value.place);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  // 시트를 연 시점의 날짜 범위입니다(최대 6개월 전까지).
  const [{ today, earliest }] = useState(() => {
    const today = seoulDate();
    const date = new Date(today + 'T00:00:00Z');
    const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 6, 1));
    const lastDay = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
    first.setUTCDate(Math.min(date.getUTCDate(), lastDay));
    return { today, earliest: first.toISOString().slice(0, 10) };
  });

  async function pickMyLocation() {
    setLocating(true);
    setLocationError('');
    try {
      const fix = await readDeviceLocation();
      setDraft((d) => ({
        ...d,
        place: '',
        near: { lat: fix.coords.latitude, lng: fix.coords.longitude, label: '내 위치' },
      }));
      setPlaceText('');
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : '위치를 확인하지 못했어요.');
    } finally {
      setLocating(false);
    }
  }

  if (picking)
    return (
      <SearchSheet
        title="기간 직접 설정"
        visible
        onClose={() => setPicking(null)}
        footer={
          <>
            <ActionButton
              label="취소"
              variant="outline"
              style={styles.secondary}
              onPress={() => setPicking(null)}
            />
            <ActionButton
              label={
                picking.from && picking.to
                  ? `${spanDays(picking.from, picking.to)}일간 선택`
                  : '끝일까지 골라 주세요'
              }
              style={styles.primary}
              disabled={!picking.from || !picking.to}
              onPress={() => {
                setDraft((d) => ({ ...d, period: 'custom', from: picking.from, to: picking.to }));
                setPicking(null);
              }}
            />
          </>
        }
      >
        <View style={styles.range}>
          <DateBox label="시작" day={picking.from} active={!picking.from || !!picking.to} />
          <Text style={styles.tilde}>~</Text>
          <DateBox label="끝" day={picking.to} active={!!picking.from && !picking.to} />
        </View>
        <RangeCalendar
          from={picking.from}
          to={picking.to}
          min={earliest}
          max={today}
          onChange={setPicking}
        />
        <Text style={styles.note}>시작일과 끝일을 차례로 눌러요 · 최대 6개월 전까지</Text>
      </SearchSheet>
    );

  const placeChosen = draft.near ? draft.near.label : draft.place;
  return (
    <SearchSheet
      title="기간 · 장소"
      visible
      onClose={onClose}
      footer={
        <>
          <ActionButton
            label="초기화"
            variant="outline"
            style={styles.secondary}
            onPress={() => {
              setDraft((d) => ({ query: d.query, period: 'all', place: '' }));
              setPlaceText('');
              setLocationError('');
            }}
          />
          <ActionButton
            label="적용하기"
            style={styles.primary}
            disabled={draft.period === 'custom' && (!draft.from || !draft.to)}
            onPress={() =>
              onApply(
                draft.period === 'custom' ? draft : { ...draft, from: undefined, to: undefined },
              )
            }
          />
        </>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
        <Text style={styles.label}>기간</Text>
        <View style={styles.segment} accessibilityRole="radiogroup">
          {periodOptions.map((option) => {
            const on = draft.period === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() =>
                  option.value === 'custom'
                    ? draft.from && draft.to
                      ? setDraft((d) => ({ ...d, period: 'custom' }))
                      : setPicking({})
                    : setDraft((d) => ({ ...d, period: option.value }))
                }
                style={[styles.segmentItem, on && styles.segmentOn]}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {draft.period === 'custom' && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`기간 ${dotted(draft.from)}부터 ${dotted(draft.to)}까지, 바꾸기`}
            onPress={() => setPicking({ from: draft.from, to: draft.to })}
            style={styles.range}
          >
            <DateBox label="시작" day={draft.from} active />
            <Text style={styles.tilde}>~</Text>
            <DateBox label="끝" day={draft.to} active />
          </Pressable>
        )}

        <View style={styles.labelRow}>
          <Text style={styles.label}>장소</Text>
          <Text style={styles.hint}>선택 · 정하면 가까운 순 정렬을 쓸 수 있어요</Text>
        </View>
        {placeChosen ? (
          <View style={styles.chosen}>
            <Icon name="info-place" size={20} tintColor={colors.blue} />
            <View style={styles.chosenText}>
              <Text style={styles.chosenName} numberOfLines={1}>
                {placeChosen}
              </Text>
              {!!draft.near && draft.near.label !== '내 위치' && (
                <Text style={styles.chosenSub}>가까운 순 정렬 가능</Text>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="장소 지우기"
              hitSlop={10}
              onPress={() => {
                setDraft((d) => ({ ...d, place: '', near: undefined }));
                setPlaceText('');
              }}
            >
              <Text style={styles.clear}>×</Text>
            </Pressable>
          </View>
        ) : (
          <PlaceSearchField
            label="장소"
            hideLabel
            placeholder="장소 이름이나 주소 검색"
            value={placeText}
            onChangeText={(text) => {
              setPlaceText(text);
              // 후보를 고르지 않고 입력만 하면 이름으로만 찾고, 가까운 순은 쓸 수 없어요.
              setDraft((d) => ({ ...d, place: text, near: undefined }));
            }}
            onPick={(name, place) =>
              setDraft((d) => ({
                ...d,
                place: name,
                near:
                  place?.lat !== undefined && place.lng !== undefined
                    ? { lat: place.lat, lng: place.lng, label: name }
                    : undefined,
              }))
            }
          />
        )}
        {!draft.near && (
          <View style={styles.quick}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="내 위치를 기준으로 정하기"
              disabled={locating}
              onPress={() => void pickMyLocation()}
              style={styles.quickChip}
            >
              <Icon name="pin" size={14} />
              <Text style={styles.quickText}>{locating ? '위치 확인 중…' : '내 위치'}</Text>
            </Pressable>
          </View>
        )}
        {!!locationError && <FormMessage small>{locationError}</FormMessage>}
        <Text style={styles.note}>
          {draft.near?.label === '내 위치'
            ? '내 위치는 가까운 순 정렬에만 쓰여요.'
            : '장소를 정하면 그 장소 이름이 들어간 물품을 찾아요.'}
        </Text>
      </ScrollView>
    </SearchSheet>
  );
}

function DateBox({ label, day, active }: { label: string; day?: string; active: boolean }) {
  return (
    <View style={[styles.date, active && styles.dateActive]}>
      <Icon name="info-date" size={16} tintColor={active ? colors.blue : colors.muted} />
      <View>
        <Text style={styles.dateLabel}>{label}</Text>
        <Text style={[styles.dateValue, !day && styles.dateEmpty]}>{dotted(day)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 0 },
  label: { ...typography.label, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  hint: { ...typography.body, fontSize: 12, color: colors.muted, flexShrink: 1, marginLeft: 8 },
  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 12,
    backgroundColor: '#F2F4F6',
    marginBottom: 12,
  },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segmentOn: { backgroundColor: colors.white },
  segmentText: { ...typography.label, fontSize: 13, color: colors.body },
  segmentTextOn: { color: colors.blue, fontWeight: '700' },
  range: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  tilde: { ...typography.body, color: colors.muted },
  date: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateActive: { borderColor: colors.blue, borderWidth: 1.5, backgroundColor: colors.lightBlue },
  dateLabel: { ...typography.body, fontSize: 11, lineHeight: 14, color: colors.body },
  dateValue: { ...typography.label, fontSize: 14, fontWeight: '700' },
  dateEmpty: { color: colors.muted, fontWeight: '500' },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.blue,
    backgroundColor: colors.lightBlue,
  },
  chosenText: { flex: 1 },
  chosenName: { ...typography.label, fontSize: 15, fontWeight: '700' },
  chosenSub: { ...typography.body, fontSize: 12, lineHeight: 16 },
  clear: { fontSize: 22, lineHeight: 24, color: colors.muted },
  quick: { flexDirection: 'row', gap: 6, marginTop: 10 },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F2F4F6',
  },
  quickText: { ...typography.label, fontSize: 13, color: '#4E5968' },
  note: { ...typography.body, fontSize: 12, color: colors.muted, marginTop: 10 },
  secondary: { flex: 0, minWidth: 100 },
  primary: { flex: 1 },
});
