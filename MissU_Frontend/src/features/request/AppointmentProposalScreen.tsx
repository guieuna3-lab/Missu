import { useState } from 'react';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage } from '@/components/FormField';
import { PlaceSearchField } from '@/features/place/PlaceSearchField';
import { useActivity } from '@/lib/activity/ActivityProvider';
import type { Party } from '@/lib/activity/types';
import { isTimeText, normalizeTimeText, parseDate } from '@/lib/dateTime';
import { requestErrorMessage } from '@/lib/mockRequest';

// Figma 08.03-A (requester) and 08-B.02-B (holder): the same form for both sides.
export function AppointmentProposalScreen({
  requestId,
  role,
  onBack,
  onSent,
}: {
  requestId: string;
  role: Party;
  onBack: () => void;
  onSent: () => void;
}) {
  const { proposeAppointment } = useActivity();
  const [place, setPlace] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [errors, setErrors] = useState<{ place?: string; date?: string; time?: string }>({});
  const [requestError, setRequestError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function send() {
    if (submitting) return;
    const next: typeof errors = {};
    if (!place.trim()) next.place = '약속 장소를 입력해 주세요.';
    if (!parseDate(date)) next.date = '2026.10.06 형식으로 입력해 주세요.';
    if (!isTimeText(time)) next.time = '17:00 형식으로 입력해 주세요.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    setRequestError(undefined);
    try {
      await proposeAppointment(requestId, role, {
        place: place.trim(),
        date: date.trim().replace(/[-/]/g, '.'),
        time: normalizeTimeText(time),
      });
      onSent();
    } catch (caught) {
      setRequestError(requestErrorMessage(caught));
      setSubmitting(false);
    }
  }

  const clear = (field: keyof typeof errors) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  return (
    <FlowScreen
      title="약속 제안"
      onBack={onBack}
      heading="약속 장소·시간 제안"
      actions={<ActionButton label="제안 보내기" onPress={send} loading={submitting} />}
    >
      <PlaceSearchField
        label="약속 장소"
        required
        placeholder="중앙도서관 1층 안내데스크"
        value={place}
        onChangeText={(value) => {
          setPlace(value);
          clear('place');
        }}
        error={errors.place}
        returnKeyType="next"
      />
      <FormField
        label="날짜"
        required
        placeholder="2026.10.06"
        value={date}
        onChangeText={(value) => {
          setDate(value);
          clear('date');
        }}
        error={errors.date}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        returnKeyType="next"
      />
      <FormField
        label="시간"
        required
        placeholder="17:00"
        value={time}
        onChangeText={(value) => {
          setTime(value);
          clear('time');
        }}
        error={errors.time}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        onSubmitEditing={send}
      />
      {requestError && <FormMessage>{requestError}</FormMessage>}
    </FlowScreen>
  );
}
