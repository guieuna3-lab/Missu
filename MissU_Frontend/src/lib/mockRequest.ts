import { ApiError } from './backend';
import { ActivityError } from './activity/transitions';

// 개발용 예시 세션에서만 사용하는 지연 응답입니다. 실제 API와 예시 데이터는 분리합니다.
// 운영 빌드에서 이 함수가 호출되면 성공 처리하지 않고 거절합니다.
// 아래 requestErrorMessage는 실제 API 오류를 표시하는 화면에서도 사용합니다.
export class RequestUnavailableError extends Error {}

// A short wait keeps the submitting state visible, like a network request.
const MOCK_DELAY_MS = 300;

export function respond<T>(value: T): Promise<T> {
  if (!__DEV__) return Promise.reject(new RequestUnavailableError());
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_DELAY_MS));
}

export function requestErrorMessage(error: unknown) {
  if (error instanceof RequestUnavailableError) return '서버 연결 전이라 아직 이용할 수 없어요.';
  if (error instanceof ApiError || error instanceof ActivityError) return error.message;
  return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
