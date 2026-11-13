import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Card } from '@/components/Card';
import { FlowScreen } from '@/components/FlowScreen';
import { FormField, FormMessage, TextLink } from '@/components/FormField';
import { PlaceSearchField } from '@/features/place/PlaceSearchField';
import { colors } from '@/constants/theme';
import { useActivity } from '@/lib/activity/ActivityProvider';
import { itemRepository, type PublicItem } from '@/lib/items';
import { requestErrorMessage } from '@/lib/mockRequest';
import { goBack, leaveFlowTo } from '@/lib/navigation';
import { usePreview } from '@/lib/preview/PreviewProvider';

const REQUIRED_MESSAGE = '필수 정보를 입력해 주세요.';

// Figma 08.01 and 08.01-E. Reached from 03.M after the 07 phone verification.
export function RequestFormScreen() {
  const { itemId = '' } = useLocalSearchParams<{ itemId?: string }>();
  const { profile } = usePreview();
  const { sendRequest } = useActivity();
  const [item, setItem] = useState<PublicItem>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [feature, setFeature] = useState('');
  const [lostInfo, setLostInfo] = useState('');
  const [placeQuery, setPlaceQuery] = useState<string>();
  const [errors, setErrors] = useState<{ feature?: string; lostInfo?: string }>({});
  const [requestError, setRequestError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const back = () => goBack({ pathname: '/items/[id]', params: { id: itemId } });

  useEffect(() => {
    let active = true;
    itemRepository
      .find(itemId)
      .then((value) => {
        if (!active) return;
        setItem(value);
        setStatus(value ? 'ready' : 'error');
      })
      .catch(() => active && setStatus('error'));
    return () => {
      active = false;
    };
  }, [itemId]);

  async function submit() {
    if (submitting || !item || !profile) return;
    const next: typeof errors = {};
    if (!feature.trim()) next.feature = REQUIRED_MESSAGE;
    if (!lostInfo.trim()) next.lostInfo = REQUIRED_MESSAGE;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSubmitting(true);
    setRequestError(undefined);
    try {
      const request = await sendRequest({
        itemId: item.id,
        itemName: item.name,
        storageName: item.storage,
        requesterName: profile.name,
        feature: feature.trim(),
        lostInfo: lostInfo.trim(),
      });
      router.replace({ pathname: '/requests/[id]', params: { id: request.id } });
    } catch (caught) {
      setRequestError(requestErrorMessage(caught));
      setSubmitting(false);
    }
  }

  if (status !== 'ready' || !item)
    return (
      <FlowScreen
        title="주인 확인 요청"
        onBack={back}
        heading={status === 'error' ? '물품 정보를 불러오지 못했어요' : undefined}
        actions={
          status === 'error' ? (
            <ActionButton label="검색으로 돌아가기" onPress={() => leaveFlowTo('/search')} />
          ) : undefined
        }
      >
        {status === 'loading' && <ActivityIndicator color={colors.blue} />}
      </FlowScreen>
    );

  return (
    <FlowScreen
      title="주인 확인 요청"
      onBack={back}
      heading="주인만 아는 정보를 알려 주세요"
      actions={<ActionButton label="주인 확인 요청 보내기" onPress={submit} loading={submitting} />}
    >
      <Card title={item.name}>공개 사진에 보이지 않는 특징을 적어 주세요.</Card>
      <FormField
        label="물품 특징"
        required
        placeholder="주인만 알 수 있는 특징을 입력하세요"
        value={feature}
        onChangeText={(value) => {
          setFeature(value);
          setErrors((current) => ({ ...current, feature: undefined }));
        }}
        error={errors.feature}
        returnKeyType="next"
      />
      <FormField
        label="분실 날짜·시간 범위 / 장소"
        required
        placeholder="2026.10.06 14:00~18:00 · 중앙도서관"
        value={lostInfo}
        onChangeText={(value) => {
          setLostInfo(value);
          setErrors((current) => ({ ...current, lostInfo: undefined }));
        }}
        error={errors.lostInfo}
        onSubmitEditing={submit}
      />
      {placeQuery === undefined ? (
        <TextLink label="분실 장소 검색" onPress={() => setPlaceQuery('')} />
      ) : (
        <PlaceSearchField
          label="분실 장소 검색"
          placeholder="장소명 또는 주소"
          value={placeQuery}
          onChangeText={setPlaceQuery}
          onPick={(name) => {
            // 날짜·시간이나 비공개 특징을 지도 서비스에 보내지 않고 장소만 덧붙입니다.
            setLostInfo((previous) => [previous.trim(), name].filter(Boolean).join(' · '));
            setErrors((previous) => ({ ...previous, lostInfo: undefined }));
            setPlaceQuery(undefined);
          }}
        />
      )}
      <Card title="보관자에게만 전달돼요" blue>
        {'작성한 정보는 공개되지 않습니다.\n휴대전화 인증만으로 소유 여부가 확인되지는 않아요.'}
      </Card>
      {requestError && <FormMessage>{requestError}</FormMessage>}
    </FlowScreen>
  );
}
