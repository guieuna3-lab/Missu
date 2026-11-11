import { api } from '@/lib/backend';
import { FormMessage } from '@/components/FormField';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { ChoiceRow } from '@/components/ChoiceRow';
import { ConfirmDialog } from '@/components/Dialog';
import { FlowScreen } from '@/components/FlowScreen';
import { colors } from '@/constants/theme';
import { LoginGateScreen } from '@/features/auth/LoginGateScreen';
import { maskPhone } from '@/features/verify/phone';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { usePreview } from '@/lib/preview/PreviewProvider';

// Figma 02-A.06 with 02-A.06-U (phone verification removed) and 02-A.06-C (leave account).
export function AccountScreen() {
  const { profile, clearPhone, exitMemberPreview, accessToken } = usePreview();
  const [leaving, setLeaving] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function accountAction(kind: 'phone' | 'withdraw') {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (accessToken)
        await api(kind === 'phone' ? '/me/phone' : '/me', {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + accessToken },
        });
      if (kind === 'phone') {
        clearPhone();
        setCleared(true);
      } else {
        setLeaving(false);
        exitMemberPreview();
        leaveFlowTo('/home');
      }
    } catch (e) {
      setLeaving(false);
      setError(e instanceof Error ? e.message : '처리하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }
  if (!profile) return <LoginGateScreen kind="history" />;

  const phoneDescription = profile.phone
    ? `현재 인증됨 · ${maskPhone(profile.phone)}`
    : profile.phoneVerified
      ? '현재 인증됨'
      : cleared
        ? '연락처 인증이 해제되었어요.'
        : '아직 인증한 연락처가 없어요.';

  return (
    <FlowScreen
      title="계정 관리"
      onBack={() => goBack('/history')}
      heading="계정 관리"
      actions={
        <ActionButton
          label="내역으로 돌아가기"
          variant="outline"
          onPress={() => leaveFlowTo('/history')}
          style={styles.blueOutline}
        />
      }
    >
      <ChoiceRow
        icon="lock"
        title="비밀번호 변경"
        description="새 비밀번호로 변경합니다."
        onPress={() => router.push('/account/password')}
      />
      <ChoiceRow
        icon="user"
        title="연락처 인증 해제"
        description={phoneDescription}
        onPress={() => void accountAction('phone')}
        disabled={busy || !(profile.phoneVerified || profile.phone)}
      />
      <ChoiceRow
        icon="search"
        title="회원 탈퇴"
        description="계정 탈퇴 안내 확인"
        disabled={busy}
        onPress={() => setLeaving(true)}
      />
      {error && <FormMessage>{error}</FormMessage>}
      {leaving && (
        <ConfirmDialog
          title="회원 탈퇴할까요?"
          message="내 분실 신고와 이동 경로가 삭제되고, 등록한 습득물은 검색에서 사라집니다. 진행 중인 반환 요청도 종료됩니다."
          onCancel={() => setLeaving(false)}
          loading={busy}
          onConfirm={() => void accountAction('withdraw')}
        />
      )}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  blueOutline: { borderColor: colors.blue },
});
