import { router } from 'expo-router';
import { useState } from 'react';
import { useActivity } from '@/lib/activity/ActivityProvider';
import type { Place } from '@/lib/activity/types';
import { parseDateTime } from '@/lib/dateTime';
import { requestErrorMessage } from '@/lib/mockRequest';
import { goBack } from '@/lib/navigation';
import { PlacePickerScreen } from '@/features/place/PlacePickerScreen';
import { useReportDraft } from './ReportDraft';

// Figma 04.04 → 09: choosing the place saves the report (or the edit) and opens 04.05.
export function LostWhereScreen() {
  const { lost, resetLost } = useReportDraft();
  const { createLostReport, updateLostReport } = useActivity();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function select(place: Place) {
    if (submitting) return;
    const lostFrom = parseDateTime(lost.fromText);
    const lostTo = lost.toText.trim() ? parseDateTime(lost.toText) : lostFrom;
    if (!lostFrom || !lostTo) {
      // The previous step validates this; only a direct link can get here.
      goBack('/report/lost/when');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    const input = {
      category: lost.category,
      name: lost.name.trim(),
      feature: lost.feature.trim(),
      lostFrom,
      lostTo,
      place,
    };
    try {
      if (lost.editingId) {
        await updateLostReport(lost.editingId, input);
        router.dismissTo({ pathname: '/my-reports/[id]', params: { id: lost.editingId } });
      } else {
        const report = await createLostReport(input);
        router.replace({ pathname: '/report/lost/done', params: { id: report.id } });
      }
      resetLost();
    } catch (requestError) {
      setError(requestErrorMessage(requestError));
      setSubmitting(false);
    }
  }

  return (
    <PlacePickerScreen
      variant="lost"
      initialPlace={lost.place}
      submitting={submitting}
      error={error}
      onSelect={select}
      onBack={() => goBack('/report/lost/when')}
    />
  );
}
