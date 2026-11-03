import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Notice, Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { formatFoundAt, itemRepository } from './items';
import type { PublicItem } from './items';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ItemDetail key={id} id={id} />;
}

function ItemDetail({ id }: { id: string }) {
  const [item, setItem] = useState<PublicItem>();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    itemRepository
      .find(id)
      .then((value) => {
        if (active) {
          setItem(value);
          setStatus('success');
        }
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [id, retry]);
  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/search');
  }
  return (
    <>
      <Screen
        title="습득물 상세"
        onBack={back}
        action={
          item && status === 'success' ? (
            <Button
              onPress={() =>
                setNotice(
                  '주인 확인 요청은 로그인 후 가능해요. 로그인 화면과 요청 작성 기능은 아직 연결되지 않았어요.',
                )
              }
            >
              로그인하고 내 물건 확인
            </Button>
          ) : undefined
        }
      >
        <ScrollView contentContainerStyle={styles.content}>
          {status === 'loading' && (
            <View style={styles.card}>
              <ActivityIndicator color={colors.blue} />
              <Text style={typography.body}>물품 정보를 불러오고 있어요.</Text>
            </View>
          )}
          {status === 'error' && (
            <>
              <Text accessibilityRole="alert" style={typography.heading}>
                물품 정보를 불러오지 못했어요
              </Text>
              <Button
                onPress={() => {
                  setStatus('loading');
                  setItem(undefined);
                  setRetry((v) => v + 1);
                }}
              >
                다시 시도
              </Button>
            </>
          )}
          {status === 'success' && !item && (
            <>
              <Text style={typography.heading}>물품을 찾을 수 없어요</Text>
              <Text style={typography.body}>삭제되었거나 올바르지 않은 물품 주소예요.</Text>
              <Button onPress={back}>검색으로 돌아가기</Button>
            </>
          )}
          {status === 'success' && item && (
            <>
              <View style={[styles.card, styles.photo]}>
                <Text style={typography.label}>물품 사진</Text>
                <Text style={typography.body}>등록 사진 미리보기 영역</Text>
              </View>
              <Text accessibilityRole="header" style={typography.heading}>
                {item.name}
              </Text>
              <Text style={[typography.label, styles.blue]}>
                보관 중 · {formatFoundAt(item.foundAt)}
              </Text>
              <View style={styles.card}>
                <Text style={typography.label}>습득 위치</Text>
                <Text style={typography.body}>{item.location}</Text>
              </View>
              <View style={styles.card}>
                <Text style={typography.label}>보관·수령 안내</Text>
                <Text style={typography.body}>
                  {item.storage}
                  {'\n'}
                  {item.collectionGuide}
                </Text>
              </View>
              <Text style={typography.body}>
                {'공개 정보는 조회할 수 있어요.\n주인 확인 요청은 로그인 후 가능합니다.'}
              </Text>
            </>
          )}
        </ScrollView>
      </Screen>
      <Notice message={notice} onClose={() => setNotice('')} />
    </>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  card: { backgroundColor: colors.white, padding: 16, borderRadius: 12, gap: 8 },
  photo: { backgroundColor: colors.photo },
  blue: { color: colors.blue },
});
