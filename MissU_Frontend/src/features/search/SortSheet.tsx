import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';
import type { SearchSort } from '@/lib/searchRank';
import { SearchSheet } from './SearchSheet';

export const sortLabels: Record<SearchSort, string> = {
  recent: '최신순',
  distance: '가까운 순',
  relevance: '정확도순',
};

/** 검색 결과 정렬을 고르는 시트. 가까운 순은 기준 좌표가 있을 때만 고를 수 있습니다. */
export function SortSheet({
  value,
  query,
  nearLabel,
  onClose,
  onChange,
}: {
  value: SearchSort;
  query: string;
  nearLabel?: string;
  onClose: () => void;
  onChange: (sort: SearchSort) => void;
}) {
  const options: { value: SearchSort; icon: IconName; hint: string; disabled?: boolean }[] = [
    { value: 'recent', icon: 'info-date', hint: '최근에 등록된 물품부터' },
    {
      value: 'distance',
      icon: 'info-place',
      hint: nearLabel
        ? `${nearLabel}에서 가까운 물품부터`
        : "'기간 · 장소'에서 장소를 고르면 쓸 수 있어요",
      disabled: !nearLabel,
    },
    {
      value: 'relevance',
      icon: 'check',
      hint: query.trim()
        ? `'${query.trim()}'과 가장 잘 맞는 물품부터`
        : '검색어와 잘 맞는 물품부터',
    },
  ];
  return (
    <SearchSheet title="정렬" visible onClose={onClose}>
      <View accessibilityRole="radiogroup">
        {options.map((option, index) => {
          const on = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: option.disabled }}
              accessibilityLabel={`${sortLabels[option.value]}, ${option.hint}`}
              disabled={option.disabled}
              onPress={() => onChange(option.value)}
              style={[
                styles.option,
                index === options.length - 1 && styles.last,
                option.disabled && styles.disabled,
              ]}
            >
              <View style={[styles.icon, on && styles.iconOn]}>
                <Icon
                  name={option.icon}
                  size={19}
                  tintColor={option.icon === 'check' ? undefined : on ? colors.blue : colors.body}
                />
              </View>
              <View style={styles.text}>
                <Text style={styles.name}>{sortLabels[option.value]}</Text>
                <Text style={styles.hint}>{option.hint}</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]} />
            </Pressable>
          );
        })}
      </View>
    </SearchSheet>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  last: { borderBottomWidth: 0 },
  disabled: { opacity: 0.45 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F4F6',
  },
  iconOn: { backgroundColor: colors.lightBlue },
  text: { flex: 1, gap: 1 },
  name: { ...typography.label, fontSize: 15, fontWeight: '700' },
  hint: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border },
  radioOn: { borderWidth: 6, borderColor: colors.blue },
});
