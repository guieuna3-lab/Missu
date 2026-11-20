import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Card } from '@/components/Card';
import { ActionButton } from '@/components/ActionButton';
import { FormMessage } from '@/components/FormField';
import { api } from '@/lib/backend';
import { usePreview } from '@/lib/preview/PreviewProvider';
import { enablePush, nativePush } from './push';

export function MatchAlertSettings({ id }: { id: string }) {
  const { accessToken } = usePreview();
  return <ReportAlertSettings key={id + accessToken} id={id} />;
}
function ReportAlertSettings({ id }: { id: string }) {
  const { accessToken, profile } = usePreview();
  const [enabled, setEnabled] = useState<boolean>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    if (accessToken)
      void api<{ data: { enabled: boolean } }>('/notifications/reports/' + id, {
        headers: { Authorization: 'Bearer ' + accessToken },
      })
        .then((r) => {
          if (live) setEnabled(r.data.enabled);
        })
        .catch(() => {
          if (live) setMessage('알림 설정을 불러오지 못했어요.');
        });
    return () => {
      live = false;
    };
  }, [id, accessToken]);
  async function change(next: boolean, phone = false) {
    if (!accessToken || !profile || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (phone) await enablePush(profile.email, accessToken);
      await api('/notifications/reports/' + id, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      setEnabled(next);
      setMessage(
        next
          ? phone
            ? '휴대폰 알림을 켰어요.'
            : '앱 안의 알림을 켰어요.'
          : '이 신고의 새 알림을 중지했어요.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '알림을 설정하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Card title="비슷한 습득물 알림">
        알림을 켠 뒤 새로 확인되는 물품 중, 종류가 비슷하고 분실 장소와 이름이 맞거나 약 3km 안에
        있는 물품을 알려드려요. 소유가 확인됐다는 뜻은 아니에요.
      </Card>
      {nativePush && (
        <ActionButton
          label="휴대폰 알림 켜기"
          disabled={busy}
          onPress={() => void change(true, true)}
        />
      )}
      <ActionButton
        label={enabled ? '이 신고 알림 끄기' : '앱 안에서 알림 받기'}
        variant="outline"
        disabled={busy}
        onPress={() => void change(!enabled)}
      />
      {!nativePush && (
        <FormMessage>
          아이폰은 Safari에서 미슈를 홈 화면에 추가한 뒤 아이콘으로 열어 주세요. iOS 16.4 이상에서
          알림을 켤 수 있어요. 안드로이드는 알림 기능이 추가된 APK를 사용해 주세요.
        </FormMessage>
      )}
      {!!message && <FormMessage>{message}</FormMessage>}
    </View>
  );
}
