import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import { Screen } from '@/components/Screen';
import { typography } from '@/constants/theme';
import { institutionDetail, type InstitutionItem } from '@/lib/institutionItems';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { mapApi } from '../nearby/mapData';

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
            {item.source === '한성대' && (
              <ActionButton
                variant="outline"
                label="별도 시연 물품으로 수령 연습"
                onPress={() =>
                  router.push({ pathname: '/items/[id]', params: { id: 'hansung-demo' } })
                }
              />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

type Demo = {
  role: 'keeper' | 'requester';
  request: { id: string; status: keyof typeof labels } | null;
};
const labels = {
  PENDING: '요청 접수',
  APPROVED: '승인 완료',
  HANDED_OVER: '담당자 전달 완료',
  RETURNED: '수령 완료',
  REJECTED: '요청 거절',
} as const;
export function HansungDemoScreen() {
  const { profile, accessToken, startLogin } = usePreview();
  const [data, setData] = useState<Demo>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError('');
      setData(undefined);
      if (accessToken)
        void mapApi<Demo>('/hansung-demo', { token: accessToken }).then(
          (v) => {
            if (active) setData(v);
          },
          (e) => {
            if (active) setError(e instanceof Error ? e.message : '시연 상태를 확인할 수 없어요.');
          },
        );
      return () => {
        active = false;
      };
    }, [accessToken]),
  );
  async function refresh() {
    if (!accessToken || busy) return;
    setBusy(true);
    setError('');
    try {
      setData(await mapApi<Demo>('/hansung-demo', { token: accessToken }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '시연 상태를 확인할 수 없어요.');
    } finally {
      setBusy(false);
    }
  }
  async function update(action?: string) {
    if (busy || !accessToken) return;
    setError('');
    setBusy(true);
    try {
      setData(
        await mapApi<Demo>(
          '/hansung-demo' + (action ? '/' + data!.request!.id + '/' + action : ''),
          { method: 'POST', token: accessToken },
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '진행 상태를 다시 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  }
  const status = data?.request?.status;
  return (
    <Screen>
      <Header title="한성대 수령 시연" onBack={back} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={typography.heading}>
          [시연용] 노트북 충전기
        </Text>
        <Card title="팀 연습용 물품">
          두 시연 계정으로 요청·승인·전달·수령을 연습해요. 학교에 방문하거나 개인정보를 입력할
          필요가 없어요.
        </Card>
        {!profile && (
          <ActionButton
            label="시연 계정으로 로그인"
            onPress={() => startLogin({ itemId: 'hansung-demo' })}
          />
        )}
        {data && (
          <>
            <Text style={typography.label}>
              {data.role === 'keeper' ? '시연 담당자' : '시연 요청자'}
            </Text>
            <Card title="진행 상태">{status ? labels[status] : '아직 수령 요청이 없어요.'}</Card>
            {data.role === 'requester' &&
              (!status || status === 'RETURNED' || status === 'REJECTED') && (
                <ActionButton
                  loading={busy}
                  label="시연 물품 수령 요청"
                  onPress={() => void update()}
                />
              )}
            {data.role === 'keeper' && status === 'PENDING' && (
              <>
                <ActionButton
                  loading={busy}
                  label="요청 승인"
                  onPress={() => void update('approve')}
                />
                <ActionButton
                  variant="outline"
                  disabled={busy}
                  label="요청 거절"
                  onPress={() => void update('reject')}
                />
              </>
            )}
            {data.role === 'keeper' && status === 'APPROVED' && (
              <ActionButton
                loading={busy}
                label="물품 전달 확인"
                onPress={() => void update('handover')}
              />
            )}
            {data.role === 'requester' && status === 'HANDED_OVER' && (
              <ActionButton
                loading={busy}
                label="물품 수령 확인"
                onPress={() => void update('receive')}
              />
            )}
          </>
        )}
        {error && <Text accessibilityRole="alert">{error}</Text>}
        {profile && (
          <ActionButton
            disabled={busy}
            variant="outline"
            label="진행 상태 새로고침"
            onPress={() => void refresh()}
          />
        )}
      </ScrollView>
    </Screen>
  );
}
const styles = StyleSheet.create({ content: { padding: 20, gap: 16 } });
