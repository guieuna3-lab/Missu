import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChoiceRow } from '@/components/ChoiceRow';
import { BottomSheet } from '@/components/Dialog';
import { FormMessage } from '@/components/FormField';
import { Icon } from '@/components/Icon';
import { colors, typography } from '@/constants/theme';
import { requestErrorMessage } from '@/lib/mockRequest';
import { MAX_PHOTOS, pickPhoto, type PhotoSource } from './mockPhotoPicker';

// Figma 05.01 "물품 사진 *" card (empty and filled), the 05.01-A source sheet, and the
// "사진 첨부" row of 08-A.01. Photos are counted only; see mockPhotoPicker.ts.
export function PhotoAttachment({
  count,
  onChange,
  onDenied,
  required = true,
}: {
  count: number;
  onChange: (count: number) => void;
  /** The OS refused camera or library access (Figma 05.01-P). */
  onDenied: () => void;
  required?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const title = `물품 사진${required ? ' *' : ''}${count ? ` · 최대 ${MAX_PHOTOS}장` : ''}`;

  async function add(source: PhotoSource) {
    if (adding) return;
    setAdding(true);
    setError(undefined);
    try {
      const result = await pickPhoto(source);
      setChoosing(false);
      if (result.status === 'added') onChange(Math.min(MAX_PHOTOS, count + 1));
      else if (result.status === 'denied') onDenied();
    } catch (requestError) {
      setError(requestErrorMessage(requestError));
    } finally {
      setAdding(false);
    }
  }

  return (
    <View style={[styles.card, count === 0 && styles.emptyCard]}>
      <Text style={typography.label}>{title}</Text>
      {count === 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="사진 추가"
          onPress={() => setChoosing(true)}
          style={styles.emptyRow}
        >
          <View style={styles.thumbnail}>
            <Icon name="camera" />
          </View>
          <Text style={typography.body}>{'사진 추가\n1장 이상 첨부해 주세요'}</Text>
        </Pressable>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {Array.from({ length: count }, (_, index) => (
            <View key={index} style={styles.thumbnail}>
              <Icon name="camera" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`사진 ${index + 1} 삭제`}
                hitSlop={8}
                onPress={() => onChange(count - 1)}
                style={styles.remove}
              >
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            </View>
          ))}
          {count < MAX_PHOTOS && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="사진 추가"
              onPress={() => setChoosing(true)}
              style={[styles.thumbnail, styles.addTile]}
            >
              <Icon name="camera" />
              <Text style={styles.addText}>추가</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
      {error && <FormMessage small>{error}</FormMessage>}
      {choosing && (
        <BottomSheet title="사진 추가" onClose={() => setChoosing(false)}>
          <ChoiceRow
            icon="camera"
            title="카메라 촬영"
            description="카메라로 물품을 촬영합니다."
            onPress={() => void add('camera')}
            disabled={adding}
          />
          <ChoiceRow
            icon="search"
            title="앨범에서 선택"
            description={`최대 ${MAX_PHOTOS}장까지 선택할 수 있어요.`}
            onPress={() => void add('library')}
            disabled={adding}
          />
        </BottomSheet>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 16, gap: 12 },
  emptyCard: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { gap: 8 },
  thumbnail: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  addTile: { gap: 2, borderStyle: 'dashed' },
  addText: { ...typography.body, fontSize: 11, lineHeight: 14, color: colors.blue },
  remove: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { ...typography.label, fontSize: 16, lineHeight: 20, color: colors.ink },
});
