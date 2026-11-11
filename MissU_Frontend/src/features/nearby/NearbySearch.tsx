import { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TextLink } from '@/components/FormField';
import { Header } from '@/components/Header';
import { colors, typography } from '@/constants/theme';
import { MapIcon, mapArt } from './mapArt';
import { mapApi, type Coordinates, type MapItem } from './mapData';

const suggested = ['한성대학교', '이어폰', '지갑'];

export function NearbySearch({
  query,
  recent,
  onClose,
  onLocate,
  onSearch,
  onPlace,
}: {
  query: string;
  recent: string[];
  onClose: () => void;
  onLocate: () => void;
  onSearch: (query: string) => void;
  onPlace: (point: Coordinates, label: string) => void;
}) {
  const [input, setInput] = useState(query);
  const term = input.trim();
  const [placeResult, setPlaceResult] = useState<{
    term: string;
    places: MapItem['foundLocation'][];
  }>();
  const foundPlaces = placeResult?.term === term ? placeResult.places : [];
  useEffect(() => {
    const controller = new AbortController();
    if (!term) return;
    const timer = setTimeout(() => {
      mapApi<MapItem[]>('/items?place=' + encodeURIComponent(term) + '&limit=30', {
        signal: controller.signal,
      })
        .then((rows) => {
          if (!controller.signal.aborted)
            setPlaceResult({
              term,
              places: [
                ...new Map(
                  rows.map((row) => [row.foundLocation.label, row.foundLocation]),
                ).values(),
              ],
            });
        })
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);
  const matchingPlaces = ['한성대학교'].filter((name) => name.includes(term));
  const choices = term ? matchingPlaces : recent.length ? recent : suggested;

  function submit(value: string) {
    Keyboard.dismiss();
    onSearch(value);
  }

  return (
    <View style={styles.container}>
      <View>
        <Header title="지도에서 검색" onBack={onClose} />
        <View style={styles.cancel}>
          <TextLink label="취소" onPress={onClose} />
        </View>
      </View>
      <View style={styles.searchBackdrop}>
        <View style={styles.searchBox}>
          <MapIcon source={mapArt.search} size={20} />
          <TextInput
            accessibilityLabel="장소나 물품을 검색하세요"
            placeholder="장소나 물품을 검색하세요"
            placeholderTextColor={colors.body}
            value={input}
            onChangeText={setInput}
            returnKeyType="search"
            onSubmitEditing={() => submit(term)}
            maxLength={80}
            style={styles.input}
          />
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.heading}>
          장소와 물품을 함께 찾아보세요
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            Keyboard.dismiss();
            onLocate();
          }}
          style={styles.choice}
        >
          <MapIcon source={mapArt.locate} size={22} tintColor={colors.blue} />
          <Text style={styles.actionText}>현재 위치에서 찾기</Text>
        </Pressable>
        {!!term && (
          <Pressable accessibilityRole="button" onPress={() => submit(term)} style={styles.choice}>
            <MapIcon source={mapArt.search} size={20} />
            <Text style={typography.label}>{term} 검색</Text>
          </Pressable>
        )}
        <Text style={typography.body}>
          {term ? '장소' : recent.length ? '최근 검색' : '추천 검색'}
        </Text>
        {foundPlaces.map((place) => (
          <Pressable
            accessibilityRole="button"
            key={place.label}
            style={styles.choice}
            onPress={() => onPlace(place, place.label)}
          >
            <MapIcon source={mapArt.place} size={20} />
            <Text style={typography.label}>{place.label}</Text>
          </Pressable>
        ))}
        {choices.map((choice) => (
          <Pressable
            key={choice}
            accessibilityRole="button"
            onPress={() => submit(choice)}
            style={styles.choice}
          >
            <MapIcon source={choice === '한성대학교' ? mapArt.place : mapArt.search} size={20} />
            <Text style={typography.label}>{choice}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  cancel: { position: 'absolute', right: 20, top: 0, bottom: 0, justifyContent: 'center' },
  searchBackdrop: { paddingHorizontal: 16, paddingVertical: 12, overflow: 'hidden' },
  searchBox: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  input: { ...typography.body, flex: 1, alignSelf: 'stretch', color: colors.ink },
  body: { padding: 20, gap: 10 },
  heading: { ...typography.label, fontSize: 16, fontWeight: '700', lineHeight: 24 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  actionText: { ...typography.label, color: colors.blue, fontWeight: '700' },
});
