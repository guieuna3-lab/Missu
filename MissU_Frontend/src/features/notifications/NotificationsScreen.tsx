import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { FlowScreen } from '@/components/FlowScreen';
import { Card } from '@/components/Card';
import { ActionButton } from '@/components/ActionButton';
import { FormMessage } from '@/components/FormField';
import { api } from '@/lib/backend';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { appendInbox, emptyInbox, refreshInbox, type InboxPage, type Notice } from './inboxState';

export function NotificationsScreen() {
  const { accessToken, sessionId, startLogin, restoringSession, sessionNotice, retrySession } =
    usePreview();
  return accessToken ? (
    <MemberInbox key={sessionId} token={accessToken} />
  ) : (
    <FlowScreen
      title="습득물 알림"
      heading="비슷한 습득물"
      onBack={() => router.replace('/history')}
    >
      {sessionNotice ? (
        <>
          <FormMessage>{sessionNotice}</FormMessage>
          <ActionButton label="다시 확인" onPress={retrySession} />
        </>
      ) : null}
      <ActionButton
        label={restoringSession ? '저장된 로그인 확인 중…' : '로그인하고 알림 보기'}
        disabled={restoringSession}
        onPress={() => startLogin('notifications')}
      />
    </FlowScreen>
  );
}
function MemberInbox({ token }: { token: string }) {
  const [state, setState] = useState(emptyInbox);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (cursor?: string) => {
      if (!alive.current || activeRequest.current) return;
      const controller = new AbortController();
      activeRequest.current = controller;
      setBusy(true);
      try {
        const r = await api<{ data: InboxPage }>(
          '/notifications' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
          {
            headers: { Authorization: 'Bearer ' + token },
            signal: controller.signal,
          },
        );
        if (!alive.current || controller.signal.aborted) return;
        setState((old) => (cursor ? appendInbox(old, r.data) : refreshInbox(old, r.data)));
        setError('');
      } catch (e) {
        if (alive.current && !controller.signal.aborted)
          setError(e instanceof Error ? e.message : '알림을 불러오지 못했어요.');
      } finally {
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          if (alive.current) setBusy(false);
        }
      }
    },
    [token],
  );
  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      void refresh();
      // 화면을 보고 있을 때만 확인하고, 다른 앱에서 돌아오면 즉시 갱신합니다.
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void refresh();
      }, 30000);
      const listener = AppState.addEventListener('change', (status) => {
        if (status === 'active') void refresh();
      });
      return () => {
        alive.current = false;
        clearInterval(timer);
        listener.remove();
        activeRequest.current?.abort();
        activeRequest.current = null;
      };
    }, [refresh]),
  );
  function open(n: Notice) {
    void api('/notifications/' + n.id + '/read', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    }).catch(() => undefined);
    router.push({ pathname: '/items/[id]', params: { id: n.itemId } });
  }
  return (
    <FlowScreen
      title="습득물 알림"
      heading="비슷한 습득물"
      onBack={() => router.replace('/history')}
    >
      {state.items.map((n) => (
        <Card key={n.id} title={n.itemName} onPress={() => open(n)}>
          {(n.readAt ? '확인함' : '새 알림') +
            ' · 내 분실 신고와 비슷한 물품이에요. 물품을 열어 특징과 현재 보관 상태를 확인해 주세요.'}
        </Card>
      ))}
      {state.loaded && !state.items.length && !error && (
        <Card title="아직 알림이 없어요">
          내 분실 신고에서 알림을 켜면 이후 새로 확인되는 비슷한 습득물을 알려드려요.
        </Card>
      )}
      {!state.loaded && busy && <FormMessage>알림을 불러오고 있어요.</FormMessage>}
      {!!error && <FormMessage>{error}</FormMessage>}
      <ActionButton
        label={error ? '다시 불러오기' : '새 알림 확인'}
        variant="outline"
        disabled={busy}
        onPress={() => void refresh()}
      />
      {!!state.nextCursor && (
        <ActionButton
          label="알림 더보기"
          disabled={busy}
          onPress={() => void refresh(state.nextCursor ?? undefined)}
        />
      )}
    </FlowScreen>
  );
}
