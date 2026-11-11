import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage } from '@/components/FormField';
import { colors, typography } from '@/constants/theme';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { parseDateTime } from '@/lib/dateTime';
import { requestErrorMessage } from '@/lib/mockRequest';
import { goBack } from '@/lib/navigation';
import { CategoryTiles } from './CategoryTiles';
import { DATE_TIME_FORMAT_ERROR } from './LostWhenScreen';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { choosePhoto } from './choosePhoto';
import { PhotoAttachment } from './PhotoAttachment';
import { useReportDraft } from './ReportDraft';

// Figma 05.01 (empty), 05.02 (filled), 05.01-P (photo permission) and 05.02-A (edit).
export function FoundItemScreen() {
  const { found, updateFound } = useReportDraft();
  const { updateFoundItem } = useActivity();
  const { accessToken } = usePreview();
  const editing = !!found.editingId;
  const [errors, setErrors] = useState<{ name?: string; foundAt?: string }>({});
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const complete =
    !!found.name.trim() && !!found.foundAtText.trim() && !!found.place && found.photos > 0;

  function validate() {
    const next: typeof errors = {};
    if (!found.name.trim()) next.name = '물품명을 입력해 주세요.';
    const foundAt = parseDateTime(found.foundAtText);
    if (!foundAt) next.foundAt = DATE_TIME_FORMAT_ERROR;
    setErrors(next);
    return Object.keys(next).length === 0 && found.place ? foundAt : null;
  }

  function next() {
    if (validate()) router.push('/report/found/storage');
  }

  async function save() {
    const foundAt = validate();
    if (!foundAt || !found.place || !found.editingId || saving) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await updateFoundItem(found.editingId, {
        category: found.category,
        name: found.name.trim(),
        foundAt,
        place: found.place,
        photos: found.photos,
      });
      goBack('/history');
    } catch (requestError) {
      setSaveError(requestErrorMessage(requestError));
      setSaving(false);
    }
  }

  if (denied)
    return (
      <FlowScreen
        title="습득물 등록"
        onBack={() => goBack('/report')}
        heading="사진 접근 권한이 필요해요"
        description="사진을 추가하려면 기기 설정에서 카메라 또는 사진 접근을 허용해 주세요."
        actions={<ActionButton label="필수 정보와 사진을 입력해 주세요" disabled onPress={next} />}
      >
        <ActionButton
          label="다시 확인하기"
          variant="outline"
          onPress={() => setDenied(false)}
          style={styles.blueOutline}
        />
      </FlowScreen>
    );

  return (
    <FlowScreen
      title={editing ? '습득물 등록 정보 수정' : '습득물 등록'}
      onBack={() => goBack(editing ? '/history' : '/report')}
      step={editing ? undefined : '1 / 3  물품 정보'}
      heading="어떤 물건을 주웠나요?"
      actions={
        editing ? (
          <ActionButton label="저장" onPress={save} loading={saving} />
        ) : (
          <ActionButton
            label={complete ? '다음 · 보관 정보' : '필수 정보와 사진을 입력해 주세요'}
            onPress={next}
            disabled={!complete}
          />
        )
      }
    >
      <CategoryTiles value={found.category} onChange={(category) => updateFound({ category })} />
      <FormField
        label="물품명"
        required
        placeholder="물품명을 직접 입력하세요"
        value={found.name}
        onChangeText={(name) => {
          updateFound({ name });
          setErrors((current) => ({ ...current, name: undefined }));
        }}
        error={errors.name}
        returnKeyType="next"
      />
      <FormField
        label="습득 일시"
        required
        placeholder="날짜와 시간을 입력하세요"
        value={found.foundAtText}
        onChangeText={(foundAtText) => {
          updateFound({ foundAtText });
          setErrors((current) => ({ ...current, foundAt: undefined }));
        }}
        error={errors.foundAt}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
      />
      <View style={styles.field}>
        <Text importantForAccessibility="no" accessibilityElementsHidden style={typography.label}>
          습득 위치 *
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            found.place
              ? `습득 위치, ${found.place.detail}`
              : '습득 위치, 필수, 지도에서 장소를 선택하세요'
          }
          onPress={() => router.push('/report/found/place')}
          style={({ pressed }) => [styles.select, pressed && styles.pressed]}
        >
          <Text style={[typography.body, found.place && styles.ink]} numberOfLines={1}>
            {found.place?.detail ?? '지도에서 장소를 선택하세요'}
          </Text>
        </Pressable>
      </View>
      <PhotoAttachment
        count={found.photos}
        attachments={found.attachments}
        chooseAsset={(source) => choosePhoto(source, accessToken)}
        setAttachments={(attachments) => updateFound({ attachments, photos: attachments.length })}
        onChange={(photos) => updateFound({ photos })}
        onDenied={() => setDenied(true)}
      />
      <Text style={styles.hint}>신분증·카드 사진은 이름, 번호 등 개인정보를 가려 주세요.</Text>
      {saveError && <FormMessage>{saveError}</FormMessage>}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  select: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
  },
  pressed: { opacity: 0.75 },
  ink: { color: colors.ink },
  hint: { ...typography.body, fontSize: 12, lineHeight: 18, color: colors.muted },
  blueOutline: { borderColor: colors.blue },
});
