import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { BottomNavigation } from '@/components/BottomNavigation';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { unavailableHint } from '@/constants/messages';
import { colors, typography } from '@/constants/theme';
import { previewActivity, previewItems } from '@/lib/preview/fixtures';
import { isPreview } from '@/lib/preview/PreviewProvider';

export function HomeScreen() {
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
          disabled
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          accessibilityHint={unavailableHint}
          style={styles.nearby}
        >
          <Icon name="pin" />
          <View style={styles.itemText}>
            <Text style={typography.label}>내 근처 습득물</Text>
            {isPreview && <Text style={styles.secondary}>{previewActivity.nearby}</Text>}
          </View>
          <Text style={[typography.body, { color: colors.blue }]}>보기 →</Text>
        </Pressable>
        <Text style={[typography.label, styles.sectionTitle]}>이런 분들을 도와드려요</Text>
        <View style={styles.audience}>
          {(
            [
              { icon: 'heart', label: 'ADHD', width: 80 },
              { icon: 'child', label: '아이 물건', width: 100 },
              { icon: 'shield', label: '공개 정보 조회', width: 120 },
            ] as const
          ).map((chip) => (
            <View key={chip.icon} style={[styles.chip, { minWidth: chip.width }]}>
              <Icon name={chip.icon} />
              <Text style={[typography.label, { color: colors.body }]}>{chip.label}</Text>
            </View>
          ))}
        </View>
        <Text style={[typography.label, styles.sectionTitle, { marginTop: 20 }]}>
          최근 등록된 습득물
        </Text>
        <View style={styles.items}>
          {isPreview &&
            previewItems.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })}
                style={styles.item}
              >
                <Icon name={item.icon} />
                <View style={styles.itemText}>
                  <Text style={typography.label}>{item.title}</Text>
                  <Text style={styles.secondary}>{item.location}</Text>
                </View>
                <View style={styles.status}>
                  <Text style={[typography.label, { color: colors.green }]}>보관 중</Text>
                </View>
              </Pressable>
            ))}
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
  audience: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  items: { gap: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  status: {
    minWidth: 58,
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.greenBg,
  },
});
