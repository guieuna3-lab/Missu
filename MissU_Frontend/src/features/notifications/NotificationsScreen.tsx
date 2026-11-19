import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { FlowScreen } from '@/components/FlowScreen';
import { Card } from '@/components/Card';
import { ActionButton } from '@/components/ActionButton';
import { FormMessage } from '@/components/FormField';
import { api } from '@/lib/backend';
import { usePreview } from '@/lib/preview/PreviewProvider';
type Notice = {
  id: string;
  reportId: string;
  itemId: string;
  itemName: string;
  createdAt: string;
  readAt: string | null;
};
type Page = { items: Notice[]; nextCursor: string | null };
export function NotificationsScreen() {
  const { accessToken, startLogin } = usePreview();
  const generation = useRef(0);
  const [items, setItems] = useState<Notice[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const reload = useCallback(() => {
    const request = ++generation.current;
    setItems([]);
    setCursor(null);
    setError('');
    if (accessToken) {
      setBusy(true);
      void api<{ data: Page }>('/notifications', {
        headers: { Authorization: 'Bearer ' + accessToken },
      })
        .then((r) => {
          if (request === generation.current) {
            setItems(r.data.items);
            setCursor(r.data.nextCursor);
          }
        })
        .catch((e) => {
          if (request === generation.current) setError(e.message);
        })
        .finally(() => {
          if (request === generation.current) setBusy(false);
        });
    }
  }, [accessToken]);
  useFocusEffect(
    useCallback(() => {
      reload();
      return () => {
        generation.current++;
      };
    }, [reload]),
  );
  async function more() {
    if (!cursor || busy || !accessToken) return;
    const request = generation.current;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ data: Page }>('/notifications?cursor=' + encodeURIComponent(cursor), {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (request !== generation.current) return;
      setItems((old) => [...old, ...r.data.items.filter((n) => !old.some((p) => p.id === n.id))]);
      setCursor(r.data.nextCursor);
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : '알림을 불러오지 못했어요.');
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  function open(n: Notice) {
    if (!accessToken) return;
    void api('/notifications/' + n.id + '/read', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken },
    }).catch(() => undefined);
    router.push({ pathname: '/items/[id]', params: { id: n.itemId } });
  }
  return (
    <FlowScreen
      title="습득물 알림"
      heading="비슷한 습득물"
      onBack={() => router.replace('/history')}
    >
      {!accessToken ? (
        <ActionButton label="로그인하고 알림 보기" onPress={() => startLogin('notifications')} />
      ) : (
        <>
          {items.map((n) => (
            <Card
              key={n.id}
              title={n.itemName}
              onPress={() => open(n)}
            >{`${n.readAt ? '확인함' : '새 알림'} · 내 분실 신고와 비슷한 물품이에요. 물품을 열어 특징과 현재 보관 상태를 확인해 주세요.`}</Card>
          ))}
          {!items.length && !busy && !error && (
            <Card title="아직 알림이 없어요">
              내 분실 신고에서 알림을 켜면 이후 새로 확인되는 비슷한 습득물을 알려드려요.
            </Card>
          )}
          {busy && <FormMessage>알림을 불러오고 있어요.</FormMessage>}
          {!!error && <FormMessage>{error}</FormMessage>}
          {!!error && !busy && <ActionButton label="다시 불러오기" onPress={reload} />}
          {!!cursor && (
            <ActionButton label="알림 더보기" disabled={busy} onPress={() => void more()} />
          )}
        </>
      )}
    </FlowScreen>
  );
}
