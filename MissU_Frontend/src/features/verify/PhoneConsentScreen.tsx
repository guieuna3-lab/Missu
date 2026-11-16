import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { FlowScreen } from '@/components/FlowScreen';
import { FormMessage } from '@/components/FormField';
import { colors, typography } from '@/constants/theme';
import { goBack } from '@/lib/navigation';
import { usePreview } from '@/lib/preview/PreviewProvider';

const sections = [
  { title: '수집 항목', body: '휴대전화번호, 인증 결과·시각\n주인 확인 요청·반환 진행 이력' },
  { title: '이용 목적', body: '문자 수신 확인, 반복 악용 대응,\n주인 확인과 반환 진행 관리' },
  {
    title: '공개 범위',
    body: '다른 이용자에게 전화번호를 공개하지 않습니다.\n화면에는 닉네임과 인증 상태만 표시합니다.',
  },
  {
    title: '보유 · 거부 안내',
    body: '전화번호·인증 결과: 인증 해제 또는 탈퇴까지\n동의하지 않아도 검색과 상세 조회는 가능합니다.',
  },
];

// Figma 07.00. Opened from a member item detail (03.M) before the first ownership request.
export function PhoneConsentScreen() {
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const { profile } = usePreview();
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState<string>();
  const back = () =>
    goBack(itemId ? { pathname: '/items/[id]', params: { id: itemId } } : '/history');

  function next() {
    if (!agreed) {
      // Figma does not define this message; the sign-up consent uses the same provisional text.
      setMessage('필수 항목에 동의해 주세요.');
      return;
    }
    if (profile?.phone) router.push({ pathname: '/requests/new', params: { itemId } });
    else router.push({ pathname: '/verify-phone', params: { itemId } });
  }

  return (
    <FlowScreen
      title="반환 전 · 연락처 인증 동의"
      onBack={back}
      heading="연락처는 공개하지 않습니다"
      compact
      actions={<ActionButton label="동의하고 인증하기" onPress={next} />}
    >
      {sections.map((section) => (
        <View key={section.title} style={styles.card}>
          <Text style={[typography.label, { color: colors.blue }]}>{section.title}</Text>
          <Text style={styles.small}>{section.body}</Text>
        </View>
      ))}
      <Text style={styles.small}>주민등록번호·신분증 사본·집 주소는 수집하지 않습니다.</Text>
      <View style={styles.card}>
        <Text style={[typography.label, { color: colors.blue }]}>문자 인증의 범위</Text>
        <Text style={styles.small}>
          {'전화번호 수신 여부를 확인합니다.\n물품 주인 여부는 별도의 특징 대조가 필요합니다.'}
        </Text>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="[필수] 연락처 인증 정보 수집 동의"
        accessibilityState={{ checked: agreed }}
        onPress={() => {
          setAgreed(!agreed);
          setMessage(undefined);
        }}
        hitSlop={12}
        style={styles.consent}
      >
        <Text style={typography.label}>
          {'☐  '}
          <Text style={styles.required}>[필수]</Text>
          {' 연락처 인증 정보 수집 동의'}
        </Text>
        {agreed && <Text style={styles.check}>✓</Text>}
      </Pressable>
      {message && (
        <FormMessage tone="info" small>
          {message}
        </FormMessage>
      )}
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  // Required consent stands out from the rest of the label.
  required: { color: colors.blue, fontWeight: '700' },
  card: {
    backgroundColor: colors.lightBlue,
    borderRadius: 12,
    padding: 16,
    paddingVertical: 12,
    gap: 4,
  },
  small: { ...typography.body, fontSize: 12, lineHeight: 18 },
  consent: { minHeight: 52, paddingTop: 12 },
  check: {
    position: 'absolute',
    left: 2,
    top: 10,
    fontFamily: 'NotoSansKR',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.blue,
  },
});
