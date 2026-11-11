import { goBack } from '@/lib/navigation';
import { PlacePickerScreen } from '@/features/place/PlacePickerScreen';
import { useReportDraft } from './ReportDraft';

// Figma 05.01 "습득 위치" → 09.01: the chosen place goes back into the registration form.
export function FoundPlaceScreen() {
  const { found, updateFound } = useReportDraft();
  return (
    <PlacePickerScreen
      variant="found"
      initialPlace={found.place}
      onSelect={(place) => {
        updateFound({ place });
        goBack('/report/found');
      }}
      onBack={() => goBack('/report/found')}
    />
  );
}
