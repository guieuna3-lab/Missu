import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { ChoiceRow } from '@/components/ChoiceRow';
import { ItemPhotoThumb } from '@/components/ItemPhotoThumb';
import { typography } from '@/constants/theme';
import { api } from '@/lib/backend';
import { usePreview } from '@/lib/preview/PreviewProvider';

type Match = {
  id: string;
  name: string;
  source: string;
  place: string;
  day: string;
  dateLabel: string;
};
type Matches = { data: Match[]; meta: { schoolAvailable: boolean } };

export function ReportMatches({ id }: { id: string }) {
  const { accessToken } = usePreview();
  const [result, setResult] = useState<Matches>();
  const [error, setError] = useState(false);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    setResult(undefined);
    setError(false);
    if (!accessToken || !id) return;
    try {
      const data = await api<Matches>('/lost-reports/' + encodeURIComponent(id) + '/matches', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (version === request.current) setResult(data);
    } catch {
      if (version === request.current) setError(true);
    }
  }, [accessToken, id]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        request.current++;
      };
    }, [refresh]),
  );
  if (!accessToken || !id) return null;
  return (
    <View style={styles.list}>
      <Text style={typography.heading} accessibilityRole="header">
        비슷한 습득물
      </Text>
      {error ? (
        <>
          <Text accessibilityRole="alert">후보를 불러오지 못했어요.</Text>
          <ActionButton variant="outline" label="후보 다시 찾기" onPress={() => void refresh()} />
        </>
      ) : !result ? (
        <Text accessibilityLiveRegion="polite">신고와 비슷한 습득물을 찾고 있어요.</Text>
      ) : (
        <>
          {result.data.length === 0 && (
            <Text style={typography.body}>
              아직 확인된 후보가 없어요. 나중에 신고를 다시 열면 새 물품도 확인할 수 있어요.
            </Text>
          )}
          {result.data.map((item) => (
            <ChoiceRow
              key={item.id}
              leading={<ItemPhotoThumb id={item.id} name={item.name} size={40} />}
              title={item.name}
              description={
                item.source + ' · ' + item.place + ' · ' + item.dateLabel + ' ' + item.day
              }
              onPress={() => router.push({ pathname: '/items/[id]', params: { id: item.id } })}
            />
          ))}
          {!result.meta.schoolAvailable && (
            <Text style={typography.body}>한성대 보관품은 잠시 후 다시 확인해 주세요.</Text>
          )}
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({ list: { alignSelf: 'stretch', gap: 10 } });
