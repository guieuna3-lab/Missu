import { InstitutionDetailScreen } from './InstitutionDetailScreen';
import { useEffect, useState } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionBar, ActionButton } from '@/components/ActionButton';
import { Header } from '@/components/Header';
import { LoadingState } from '@/components/LoadingState';
import { Chip, InfoCard, InfoRow, StepGuide } from '@/components/InfoList';
import { ItemPhotoGallery } from '@/components/ItemPhotoGallery';
import { Screen } from '@/components/Screen';
import { colors, typography } from '@/constants/theme';
import { categoryLabel } from '@/lib/activity/types';
import { formatFoundAt, itemRepository, type PublicItem } from '@/lib/items';
import { lookupPlaceAddress } from '@/lib/placeAddress';
import { usePreview } from '@/lib/preview/PreviewProvider';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (id === 'hansung-demo') return <Redirect href="/search" />;
  if (id?.startsWith('hansung:') || id?.startsWith('lost112:'))
    return <InstitutionDetailScreen key={id} id={id} />;
  return <ItemDetail key={id} id={id} />;
}

// 예전 앱이 버튼 이름만 저장한 물품은 상세 화면에서 그 물품의 공개 좌표로 주소를 조회합니다.
function LegacyFoundLocation({
  point,
  token,
}: {
  point: { lat: number; lng: number };
  token: string | null;
}) {
  const [address, setAddress] = useState<string | null | undefined>();
  useEffect(() => {
    let active = true;
    void lookupPlaceAddress(point, token)
      .then((result) => {
        if (active) setAddress(result);
      })
      .catch(() => {
        if (active) setAddress(null);
      });
    return () => {
      active = false;
    };
  }, [point, token]);
  return (
    <InfoRow
      icon="info-place"
      label="습득 위치"
      value={
        address === undefined
          ? '주소 확인 중'
          : (address ?? '위도 ' + point.lat.toFixed(5) + ', 경도 ' + point.lng.toFixed(5))
      }
      sub={address === null ? '주소를 확인하지 못했어요' : undefined}
    />
  );
}

const seoulDay = (time: number) => new Date(time + 9 * 3_600_000).toISOString().slice(0, 10);
/** 습득일이 오늘·어제면 그 말을 덧붙입니다. */
function dayHint(iso: string, now: number) {
  const day = seoulDay(Date.parse(iso));
  if (day === seoulDay(now)) return '오늘';
  if (day === seoulDay(now - 86_400_000)) return '어제';
  return undefined;
}

function ItemDetail({ id }: { id: string }) {
  const [today] = useState(Date.now);
  const { profile, startLogin, accessToken } = usePreview();
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
  function reloadItem() {
    setStatus('loading');
    setRetry((v) => v + 1);
  }
  return (
    <Screen>
      <Header title="습득물 상세" onBack={back} />
      <ScrollView
        contentContainerStyle={
          status === 'loading'
            ? styles.fill
            : status === 'success' && item
              ? undefined
              : styles.content
        }
      >
        {status === 'loading' && <LoadingState title="물품 정보를 불러오고 있어요" />}
        {status === 'error' && (
          <>
            <Text accessibilityRole="alert" style={typography.heading}>
              물품 정보를 불러오지 못했어요
            </Text>
            <ActionButton label="다시 시도" onPress={reloadItem} />
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
            <ItemPhotoGallery
              id={item.id}
              name={item.name}
              category={item.category}
              photoUrls={item.photoUrls}
            />
            <View style={styles.hero}>
              <Text accessibilityRole="header" style={styles.title}>
                {item.name}
              </Text>
              <View style={styles.chips}>
                <Chip label={item.statusLabel ?? '보관 중'} tone="green" />
                <Chip label={categoryLabel(item.category)} />
                <Chip label="미슈 회원 등록" />
              </View>
            </View>
            <View style={styles.body}>
              <InfoCard>
                <InfoRow
                  icon="info-date"
                  label="습득 일시"
                  value={formatFoundAt(item.foundAt)}
                  sub={dayHint(item.foundAt, today)}
                />
                {item.legacyLocation ? (
                  <LegacyFoundLocation point={item.legacyLocation} token={accessToken} />
                ) : (
                  <InfoRow icon="info-place" label="습득 위치" value={item.location} />
                )}
                <InfoRow
                  icon="info-storage"
                  label="보관처"
                  value={item.storage}
                  sub={item.collectionGuide || undefined}
                  last
                />
              </InfoCard>
              <StepGuide
                title="내 물건이라면 이렇게 찾아요"
                steps={[
                  profile
                    ? '주인만 아는 특징을 적어 확인을 요청해요.'
                    : '로그인하고 주인만 아는 특징을 적어 확인을 요청해요.',
                  '보관자가 실물과 비교해 승인하면 수령 방법을 안내받아요.',
                  '물건을 받은 뒤 앱에서 수령을 확인하면 끝나요.',
                ]}
              />
            </View>
          </>
        )}
      </ScrollView>
      {item && status === 'success' && (
        <ActionBar>
          {!profile && <Text style={styles.barHint}>공개 정보는 누구나 볼 수 있어요</Text>}
          <ActionButton
            label={profile ? '내 물건 확인 요청' : '로그인하고 내 물건 확인'}
            onPress={
              profile
                ? // Figma 03.M: a verified phone goes straight to 08.01, otherwise 07.00 first.
                  () =>
                    router.push({
                      pathname:
                        profile.phoneVerified || profile.phone
                          ? '/requests/new'
                          : '/verify-phone/consent',
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
  fill: { flexGrow: 1 },
  photoRetry: { marginHorizontal: 20, marginTop: 12 },
  hero: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 8,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { ...typography.heading, fontSize: 22, lineHeight: 30 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  body: { padding: 20, gap: 12 },
  barHint: { ...typography.body, fontSize: 12, textAlign: 'center', color: colors.muted },
});
