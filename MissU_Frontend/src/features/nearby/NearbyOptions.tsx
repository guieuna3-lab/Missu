import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '@/components/ActionButton';
import { TextLink } from '@/components/FormField';
import { colors, typography } from '@/constants/theme';
import { MapIcon, mapArt } from './mapArt';
import { categories, defaultFilters, periods, radii, type NearbyFilters } from './nearbyItems';

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityState={{ checked: option.value === value }}
          onPress={() => onChange(option.value)}
          style={[styles.chip, option.value === value && styles.activeChip]}
        >
          <Text
            style={[
              typography.label,
              styles.chipLabel,
              option.value === value && styles.activeText,
            ]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Overlay({
  onClose,
  centered = false,
  children,
}: {
  onClose: () => void;
  centered?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={[styles.overlay, centered && styles.centered]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
        />
        <View accessibilityViewIsModal style={[styles.panel, centered && styles.dialog]}>
          {children}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

export function FilterSheet({
  filters,
  onClose,
  onApply,
}: {
  filters: NearbyFilters;
  onClose: () => void;
  onApply: (filters: NearbyFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  return (
    <Overlay onClose={onClose}>
      <ScrollView bounces={false} contentContainerStyle={styles.filterBody}>
        <View style={styles.handle} />
        <View style={styles.titleRow}>
          <Text accessibilityRole="header" style={styles.title}>
            지도 검색 조건
          </Text>
          <TextLink label="닫기" onPress={onClose} />
        </View>
        <Text style={styles.groupLabel}>물품 종류</Text>
        <Chips
          options={categories}
          value={draft.category}
          onChange={(category) => setDraft((previous) => ({ ...previous, category }))}
        />
        <Text style={styles.groupLabel}>등록 기간</Text>
        <Chips
          options={periods}
          value={draft.registeredDays}
          onChange={(registeredDays) => setDraft((previous) => ({ ...previous, registeredDays }))}
        />
        <Text style={styles.groupLabel}>탐색 범위</Text>
        <Chips
          options={radii}
          value={draft.radiusM}
          onChange={(radiusM) => setDraft((previous) => ({ ...previous, radiusM }))}
        />
        <View style={styles.actions}>
          <TextLink label="초기화" onPress={() => setDraft(defaultFilters)} />
          <ActionButton label="조건 적용하기" style={styles.apply} onPress={() => onApply(draft)} />
        </View>
      </ScrollView>
    </Overlay>
  );
}

export function LocationDialog({
  onClose,
  onUseExample,
  onSearch,
}: {
  onClose: () => void;
  onUseExample: () => void;
  onSearch: () => void;
}) {
  return (
    <Overlay onClose={onClose} centered>
      <View style={styles.locationBody}>
        <MapIcon source={mapArt.locate} size={22} tintColor={colors.blue} />
        <Text accessibilityRole="header" style={styles.title}>
          내 주변 물품을 찾아볼까요?
        </Text>
        <Text style={[typography.body, styles.locationText]}>
          {'예시 지도에서는 삼선동을 기준으로 탐색해요.\n장소를 직접 검색할 수도 있어요.'}
        </Text>
        <ActionButton label="예시 위치 사용하기" onPress={onUseExample} style={styles.fullWidth} />
        <TextLink label="장소로 직접 검색하기" onPress={onSearch} />
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: {
    minHeight: 36,
    paddingHorizontal: 13,
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
  },
  chipLabel: { fontWeight: '700' },
  activeChip: { backgroundColor: colors.blue, borderColor: colors.blue },
  activeText: { color: colors.white },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: 'rgba(23, 38, 64, 0.24)',
  },
  centered: { justifyContent: 'center', paddingHorizontal: 20 },
  panel: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '90%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.white,
  },
  dialog: { maxWidth: 380, borderRadius: 24 },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  filterBody: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.label, fontWeight: '700', fontSize: 16, lineHeight: 24 },
  groupLabel: { ...typography.label, alignSelf: 'center', color: colors.body },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  apply: { flex: 1 },
  fullWidth: { alignSelf: 'stretch' },
  locationBody: { alignItems: 'center', padding: 20, paddingVertical: 24, gap: 16 },
  locationText: { textAlign: 'center' },
});
