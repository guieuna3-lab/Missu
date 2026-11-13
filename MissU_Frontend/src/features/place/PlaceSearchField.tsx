import { useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { FormField, FormMessage } from '@/components/FormField';
import { typography } from '@/constants/theme';
import { mapApi } from '@/features/nearby/mapData';

type Place = { providerPlaceId: string; name: string; address: string };
type Props = ComponentProps<typeof FormField> & {
  value: string;
  onChangeText: (value: string) => void;
  onPick?: (name: string) => void;
};
export function PlaceSearchField({ value, onChangeText, onPick, ...props }: Props) {
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState<{ term: string; places: Place[]; failed: boolean }>();
  const term = value.trim();
  useEffect(() => {
    if (!editing || !term) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      mapApi<Place[]>('/places?q=' + encodeURIComponent(term), { signal: controller.signal })
        .then((places) => {
          if (!controller.signal.aborted) setReply({ term, places, failed: false });
        })
        .catch(() => {
          if (!controller.signal.aborted) setReply({ term, places: [], failed: true });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [editing, term]);
  const current = editing && term && reply?.term === term ? reply : undefined;
  return (
    <View style={{ gap: 8 }}>
      <FormField
        {...props}
        value={value}
        onChangeText={(text) => {
          setEditing(true);
          onChangeText(text);
        }}
      />
      {current?.places.map((p) => (
        <Pressable
          key={p.providerPlaceId}
          accessibilityRole="button"
          accessibilityLabel={p.name + ', ' + p.address}
          style={{ paddingVertical: 8 }}
          onPress={() => {
            setEditing(false);
            Keyboard.dismiss();
            onChangeText(p.name);
            onPick?.(p.name);
          }}
        >
          <Text style={typography.label}>{p.name}</Text>
          {p.address !== p.name && <Text style={typography.body}>{p.address}</Text>}
        </Pressable>
      ))}
      {current && !current.places.length && (
        <FormMessage tone="info" small>
          {current.failed
            ? '장소 검색을 불러오지 못했어요. 직접 입력할 수 있어요.'
            : '일치하는 장소가 없어요. 직접 입력할 수 있어요.'}
        </FormMessage>
      )}
    </View>
  );
}
