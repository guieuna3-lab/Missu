import { useState } from 'react';
import { Image } from 'expo-image';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TextLink } from '@/components/FormField';
import { Header } from '@/components/Header';
import { colors, typography } from '@/constants/theme';
import { MapIcon, mapArt } from './mapArt';
import { places } from './nearbyItems';

const suggested = ['중앙도서관', '학생식당', '갤럭시 버즈'];

export function NearbySearch({
  query,
  recent,
  onClose,
  onLocate,
  onSearch,
}: {
  query: string;
  recent: string[];
  onClose: () => void;
  onLocate: () => void;
  onSearch: (query: string) => void;
}) {
  const [input, setInput] = useState(query);
  const term = input.trim();
  const matchingPlaces = places.filter(({ name }) => name.includes(term)).map(({ name }) => name);
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
        <Image
          accessible={false}
          source={mapArt.campus}
          contentFit="cover"
          contentPosition="top"
          style={StyleSheet.absoluteFill}
        />
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
        {choices.map((choice) => (
          <Pressable
            key={choice}
            accessibilityRole="button"
            onPress={() => submit(choice)}
            style={styles.choice}
          >
            <MapIcon
              source={places.some(({ name }) => name === choice) ? mapArt.place : mapArt.search}
              size={20}
            />
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
