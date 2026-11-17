import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ItemThumb } from '@/components/ItemThumb';
import { colors, typography } from '@/constants/theme';
import { categories, categoryLabel, type ItemCategory } from '@/lib/activity/types';

// Figma 04.02 / 05.01 "물품 종류 · 참고 정보": a horizontal row of 80×84 tiles.
export function CategoryTiles({
  value,
  onChange,
}: {
  value: ItemCategory;
  onChange: (category: ItemCategory) => void;
}) {
  return (
    <View style={styles.block}>
      <Text style={typography.label}>물품 종류 · 참고 정보</Text>
      <Text style={styles.selected}>{categoryLabel(value)}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        accessibilityRole="radiogroup"
      >
        {categories.map((category) => {
          const active = category.value === value;
          return (
            <Pressable
              key={category.value}
              accessibilityRole="radio"
              accessibilityLabel={category.label}
              accessibilityState={{ checked: active }}
              onPress={() => onChange(category.value)}
              style={[styles.tile, active && styles.activeTile]}
            >
              {/* 검색의 '자주 찾는 물건'과 같은 종류 아이콘입니다. */}
              <ItemThumb name="" category={category.value} size={36} />
              <Text style={[styles.tileLabel, active && styles.activeLabel]}>{category.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  selected: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.blue },
  row: { gap: 8 },
  tile: {
    width: 80,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  activeTile: { borderColor: colors.blue, backgroundColor: colors.lightBlue },
  tileLabel: { ...typography.body, fontSize: 11, lineHeight: 16, color: colors.body },
  activeLabel: { color: colors.blue, fontWeight: '700' },
});
