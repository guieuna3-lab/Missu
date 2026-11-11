import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField } from '@/components/FormField';
import { typography } from '@/constants/theme';
import { parseDateTime } from '@/lib/dateTime';
import { goBack } from '@/lib/navigation';
import { useReportDraft } from './ReportDraft';

// Figma does not define the date-time error texts; these are provisional.
export const DATE_TIME_FORMAT_ERROR = '2026.10.06 14:00 형식으로 입력해 주세요.';

// Figma 04.03: the lost time as a start and an optional end (range).
export function LostWhenScreen() {
  const { lost, updateLost } = useReportDraft();
  const [errors, setErrors] = useState<{ from?: string; to?: string }>({});

  function next() {
    const from = parseDateTime(lost.fromText);
    const toText = lost.toText.trim();
    const to = toText ? parseDateTime(toText) : from;
    const found: typeof errors = {};
    if (!from) found.from = DATE_TIME_FORMAT_ERROR;
    if (toText && !to) found.to = DATE_TIME_FORMAT_ERROR;
    else if (from && to && to < from) found.to = '종료 시점은 시작 시점 이후여야 해요.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    router.push('/report/lost/where');
  }

  return (
    <FlowScreen
      title="분실 시점"
      onBack={() => goBack('/report/lost')}
      step="2 / 3"
      heading="언제 잃어버렸나요?"
      description={'날짜와 시간을 선택해 주세요.\n정확한 시점을 모르면 범위로 설정할 수 있어요.'}
    >
      <FormField
        label="시작 날짜·시간"
        required
        placeholder="2026.10.06 14:00"
        value={lost.fromText}
        onChangeText={(fromText) => {
          updateLost({ fromText });
          setErrors((current) => ({ ...current, from: undefined }));
        }}
        error={errors.from}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        returnKeyType="next"
      />
      <FormField
        label="종료 날짜·시간 (범위 설정)"
        placeholder="2026.10.06 18:00"
        value={lost.toText}
        onChangeText={(toText) => {
          updateLost({ toText });
          setErrors((current) => ({ ...current, to: undefined }));
        }}
        error={errors.to}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        onSubmitEditing={next}
      />
      <Text style={typography.body}>단일 시점은 시작과 종료를 같은 값으로 설정해 주세요.</Text>
      <ActionButton label="다음 · 분실 장소" onPress={next} />
    </FlowScreen>
  );
}
