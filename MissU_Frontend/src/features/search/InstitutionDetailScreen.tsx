import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';
import { institutionDetail, type InstitutionItem } from '@/lib/institutionItems';

function back() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
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
const styles = StyleSheet.create({ content: { padding: 20, gap: 16 } });
