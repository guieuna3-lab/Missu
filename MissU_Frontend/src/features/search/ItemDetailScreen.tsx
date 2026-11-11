import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionBar, ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { categoryLabel } from '@/lib/activity/types';
import { formatFoundAt, itemRepository, type PublicItem } from '@/lib/items';
import { usePreview } from '@/lib/preview/PreviewProvider';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ItemDetail key={id} id={id} />;
}

function ItemDetail({ id }: { id: string }) {
  const { profile, startLogin } = usePreview();
  const [item, setItem] = useState<PublicItem>();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
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
    <Screen>
      <Header title="습득물 상세" onBack={back} />
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
            <ActionButton
              label="다시 시도"
              onPress={() => {
                setStatus('loading');
                setItem(undefined);
                setRetry((v) => v + 1);
              }}
            />
          </>
        )}
        {status === 'success' && !item && (
          <>
            <Text style={typography.heading}>물품을 찾을 수 없어요</Text>
            <Text style={typography.body}>삭제되었거나 올바르지 않은 물품 주소예요.</Text>
            <ActionButton label="검색으로 돌아가기" onPress={back} />
          </>
        )}
        {status === 'success' && item && (
          <>
            <View style={[styles.card, styles.photo]}>
              <Text style={typography.label}>물품 사진 · 1 / {item.photos}</Text>
              {/* Placeholders only: photo upload and viewing are not connected yet. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoRow}
              >
                {Array.from({ length: item.photos }, (_, index) => (
                  <View
                    key={index}
                    accessibilityLabel={`물품 사진 ${index + 1}`}
                    style={styles.thumbnail}
                  >
                    <Icon name="camera" />
                  </View>
                ))}
              </ScrollView>
            </View>
            <Text accessibilityRole="header" style={typography.heading}>
              {item.name}
            </Text>
            <Text style={[typography.label, styles.blue]}>
              보관 중 · {formatFoundAt(item.foundAt)}
            </Text>
            <Text style={typography.body}>종류 · {categoryLabel(item.category)}</Text>
            <Card title="습득 위치">{item.location}</Card>
            <Card title="보관·수령 안내">
              {item.storage}
              {'\n'}
              {item.collectionGuide}
            </Card>
            <Text style={typography.body}>
              {profile
                ? '반환 요청 시 주인 확인 정보를 작성합니다.'
                : '공개 정보는 조회할 수 있어요.\n주인 확인 요청은 로그인 후 가능합니다.'}
            </Text>
          </>
        )}
      </ScrollView>
      {item && status === 'success' && (
        <ActionBar>
          <ActionButton
            label={profile ? '내 물건 확인 요청' : '로그인하고 내 물건 확인'}
            onPress={
              profile
                ? // Figma 03.M: a verified phone goes straight to 08.01, otherwise 07.00 first.
                  () =>
                    router.push({
                      pathname: profile.phone ? '/requests/new' : '/verify-phone/consent',
                      params: { itemId: item.id },
                    })
                : () => startLogin({ itemId: item.id })
            }
          />
        </ActionBar>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 24, gap: 16 },
  card: { backgroundColor: colors.white, padding: 16, borderRadius: 12, gap: 8 },
  photo: { backgroundColor: '#E8F0FE' },
  photoRow: { gap: 8 },
  thumbnail: {
    width: 88,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  blue: { color: colors.blue },
});
