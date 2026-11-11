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
  const { profile, clearPhone, exitMemberPreview } = usePreview();
  const [leaving, setLeaving] = useState(false);
  const [cleared, setCleared] = useState(false);
  if (!profile) return <LoginGateScreen kind="history" />;

  const phoneDescription = profile.phone
    ? `현재 인증됨 · ${maskPhone(profile.phone)}`
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
        onPress={
          profile.phone
            ? () => {
                clearPhone();
                setCleared(true);
              }
            : undefined
        }
        disabled={!profile.phone}
      />
      <ChoiceRow
        icon="search"
        title="회원 탈퇴"
        description="계정 탈퇴 안내 확인"
        onPress={() => setLeaving(true)}
      />
      {leaving && (
        <ConfirmDialog
          title="회원 탈퇴할까요?"
          message="탈퇴 후 비회원 홈으로 이동합니다."
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            // The mock has no account to delete; the session simply ends.
            setLeaving(false);
            exitMemberPreview();
            leaveFlowTo('/home');
          }}
        />
      )}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  blueOutline: { borderColor: colors.blue },
});
