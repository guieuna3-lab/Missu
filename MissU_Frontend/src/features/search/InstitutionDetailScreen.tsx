import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';
import {
  institutionDetail,
  publicInstitutionPhotos,
  type InstitutionItem,
} from '@/lib/institutionItems';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
function InstitutionPhotos({ item }: { item: InstitutionItem }) {
  const supplied = item.photoUrls;
  const police = item.id.startsWith('lost112:');
  const [lookup, setLookup] = useState(police && !supplied?.length);
  const [publicUrls, setPublicUrls] = useState<string[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!lookup) return;
    const controller = new AbortController();
    void publicInstitutionPhotos(item.id, controller.signal).then(
      (urls) => {
        if (!controller.signal.aborted) setPublicUrls(urls);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [lookup, item.id, attempt]);

  const urls = lookup ? publicUrls : supplied;
  if (!urls?.length && !failed) return null;
  function onError() {
    // 예전 공공데이터 사진 주소가 만료됐으면 같은 물품의 경찰민원24 첨부를 다시 확인합니다.
    if (police && !lookup) setLookup(true);
    else setFailed(true);
  }
  return (
    <View style={styles.photos}>
      <Text style={typography.label}>물품 사진</Text>
      {urls?.map((uri, i) => (
        <Image
          key={uri + ':' + attempt}
          source={{ uri }}
          resizeMode="contain"
          accessibilityLabel={item.name + ' 사진 ' + (i + 1)}
          style={styles.photo}
          onError={onError}
        />
      ))}
      {failed && (
        <ActionButton
          label="기관 사진 다시 불러오기"
          variant="outline"
          onPress={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        />
      )}
    </View>
  );
}
export function InstitutionDetailScreen({ id }: { id: string }) {
  const [item, setItem] = useState<InstitutionItem>();
  const [error, setError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    void institutionDetail(id).then(
      (i) => {
        if (active) setItem(i);
      },
      (e) => {
        if (active) setError(e instanceof Error ? e.message : '상세를 불러오지 못했어요.');
      },
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);
  function open(url: string) {
    setLinkError('');
    void Linking.openURL(url).catch(() =>
      setLinkError('이 기기에서 링크를 열 수 없어요. 표시된 보관처와 관리번호를 확인해 주세요.'),
    );
  }
  return (
    <Screen>
      <Header title="기관 습득물 상세" onBack={back} />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? (
          <>
            <Text accessibilityRole="alert">{error}</Text>
            <ActionButton
              label="다시 확인"
              onPress={() => {
                setError('');
                retry((n) => n + 1);
              }}
            />
          </>
        ) : !item ? (
          <Text>기관의 보관 정보를 확인하고 있어요.</Text>
        ) : (
          <>
            <Text accessibilityRole="header" style={typography.heading}>
              {item.name}
            </Text>
            <InstitutionPhotos key={item.id} item={item} />
            <Text style={typography.label}>
              {item.source === '한성대'
                ? '한성대 · 학교 접수'
                : item.source +
                  ' · 보관 확인' +
                  (item.lastVerifiedOn ? ' ' + item.lastVerifiedOn : '')}
            </Text>
            <Card title={item.dateLabel}>
              {item.date}
              {item.dateLabel === '게시일' ? ' · 습득일 미공개' : ''}
            </Card>
            {item.foundPlace && <Card title="습득 장소">{item.foundPlace}</Card>}
            <Card title="보관처에 문의">
              {item.storage}
              {'\n'}관리번호 {item.reference}
              {item.phone ? '\n' + item.phone : ''}
              {'\n'}방문 전 보관처에 물품명과 관리번호를 알려 현재 보관 여부와 수령 방법을 확인해
              주세요.
            </Card>
            {item.phone ? (
              <ActionButton
                label="보관처에 전화하기"
                onPress={() => open('tel:' + item.phone!.replace(/[^0-9]/g, ''))}
              />
            ) : (
              <ActionButton
                label="보관처 연락처 찾기"
                onPress={() =>
                  open('https://map.kakao.com/link/search/' + encodeURIComponent(item.storage))
                }
              />
            )}
            {linkError && <Text accessibilityRole="alert">{linkError}</Text>}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  photos: { gap: 8 },
  photo: { width: '100%', height: 220, borderRadius: 12 },
});
