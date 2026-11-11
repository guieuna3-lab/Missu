import { useRef, useState } from 'react';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FormField, FormMessage } from '@/components/FormField';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';
import { api, ApiError } from '@/lib/backend';
import { usePreview } from '@/lib/preview/PreviewProvider';

export function FoundItemScreen({ token }: { token: string }) {
  const { startLogin } = usePreview();
  const [name, setName] = useState('');
  const [place, setPlace] = useState('한성대학교 캠퍼스');
  const [latitude, setLatitude] = useState('37.5824');
  const [longitude, setLongitude] = useState('127.0102');
  const [storage, setStorage] = useState('');
  const [description, setDescription] = useState('');
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState('');
  const locking = useRef(false);
  const uploaded = useRef<{ uri: string; id: string } | null>(null);
  const attempt = useRef<{ form: string; key: string; time: string } | null>(null);

  async function pickPhoto() {
    if (locking.current) return;
    locking.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      // Android 사진첩의 HEIC·PNG도 서버가 받는 단일 JPEG 사진으로 변환합니다.
      const ctx = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > 1600)
        ctx.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
      const image = await ctx.renderAsync();
      const photo = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
      ctx.release();
      image.release();
      setUri(photo.uri);
      uploaded.current = null;
    } catch {
      setError('사진을 열 수 없어요. 사진 접근 권한을 확인하거나 다른 사진을 선택해 주세요.');
    } finally {
      locking.current = false;
      setBusy(false);
    }
  }

  async function submit() {
    if (locking.current || savedId) return;
    const lat = Number(latitude.trim()),
      lng = Number(longitude.trim());
    if (!uri || !name.trim() || !place.trim() || !storage.trim()) {
      setError('물품명, 사진, 습득 장소, 보관 장소를 입력해 주세요.');
      return;
    }
    if (
      !latitude.trim() ||
      !longitude.trim() ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(lng) ||
      Math.abs(lng) > 180
    ) {
      setError('습득 장소의 위도와 경도를 확인해 주세요.');
      return;
    }
    locking.current = true;
    setBusy(true);
    setError('');
    try {
      const authorization = { Authorization: 'Bearer ' + token };
      if (!uploaded.current || uploaded.current.uri !== uri) {
        const data = new FormData();
        if (Platform.OS === 'web') data.append('file', await (await fetch(uri)).blob(), 'item.jpg');
        else data.append('file', { uri, name: 'item.jpg', type: 'image/jpeg' } as unknown as Blob);
        const upload = await api<{ data: { photoId: string } }>('/uploads', {
          method: 'POST',
          headers: authorization,
          body: data,
        });
        uploaded.current = { uri, id: upload.data.photoId };
      }
      const item = {
        name: name.trim(),
        publicFeatures: description.trim(),
        storagePlace: storage.trim(),
        foundLocation: { label: place.trim(), lat, lng },
        photoIds: [uploaded.current.id],
      };
      const form = JSON.stringify(item);
      // 등록 응답이 끊겨도 같은 입력으로 재시도하면 서버에서 한 번만 저장합니다.
      if (attempt.current?.form !== form)
        attempt.current = { form, key: Crypto.randomUUID(), time: new Date().toISOString() };
      const response = await api<{ data: { id: string } }>('/items', {
        method: 'POST',
        headers: {
          ...authorization,
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.current.key,
        },
        body: JSON.stringify({ ...item, foundAt: attempt.current.time }),
      });
      setSavedId(response.data.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setExpired(true);
      setError(e instanceof Error ? e.message : '등록하지 못했어요. 다시 시도해 주세요.');
    } finally {
      locking.current = false;
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Header title="습득물 등록" onBack={() => router.replace('/home')} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
        {savedId ? (
          <>
            <Text accessibilityRole="header" style={typography.heading}>
              {name.trim()} 등록 완료
            </Text>
            <ActionButton label="습득물 검색하기" onPress={() => router.replace('/search')} />
            <ActionButton
              variant="outline"
              label="등록한 물품 상세"
              onPress={() => router.replace({ pathname: '/items/[id]', params: { id: savedId } })}
            />
          </>
        ) : (
          <>
            <FormField
              required
              label="물품명"
              placeholder="예: 파란 우산"
              value={name}
              onChangeText={setName}
              maxLength={20}
              editable={!busy}
            />
            {uri ? (
              <Image
                source={{ uri }}
                accessibilityLabel="선택한 습득물 사진"
                style={styles.photo}
                resizeMode="contain"
              />
            ) : null}
            <ActionButton
              variant="outline"
              label={uri ? '사진 바꾸기' : '사진 선택'}
              onPress={busy ? undefined : pickPhoto}
            />
            <FormField
              required
              label="습득 장소"
              value={place}
              onChangeText={setPlace}
              maxLength={200}
              editable={!busy}
            />
            <Text style={typography.body}>
              시연 위치는 한성대학교예요. 다른 곳에서 주웠다면 장소와 좌표를 함께 바꿔 주세요.
            </Text>
            <FormField
              label="위도"
              keyboardType="numbers-and-punctuation"
              value={latitude}
              onChangeText={setLatitude}
              editable={!busy}
            />
            <FormField
              label="경도"
              keyboardType="numbers-and-punctuation"
              value={longitude}
              onChangeText={setLongitude}
              editable={!busy}
            />
            <FormField
              required
              label="보관 장소"
              placeholder="예: 학생회관 안내데스크"
              value={storage}
              onChangeText={setStorage}
              maxLength={200}
              editable={!busy}
            />
            <FormField
              label="공개 특징"
              placeholder="예: 손잡이가 검정색이에요"
              value={description}
              onChangeText={setDescription}
              maxLength={100}
              editable={!busy}
            />
            <Text style={typography.body}>습득 시각은 등록 시각으로 기록돼요.</Text>
            {!!error && <FormMessage>{error}</FormMessage>}
            {expired ? (
              <ActionButton label="다시 로그인" onPress={() => startLogin('report')} />
            ) : (
              <ActionButton label="습득물 등록하기" onPress={submit} loading={busy} />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  form: { padding: 20, gap: 16, paddingBottom: 40 },
  photo: { width: '100%', height: 160 },
});
