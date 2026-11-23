import { respond } from '@/lib/mockRequest';

// 개발용 예시 화면에서 사진 장수만 확인하는 대체 동작입니다.
// 실제 등록·신고 화면은 choosePhoto와 expo-image-picker/웹 파일 선택을 사용합니다.
export type PhotoSource = 'camera' | 'library';
export type PhotoPickResult = { status: 'added' } | { status: 'denied' } | { status: 'cancelled' };

export const MAX_PHOTOS = 5;

export function pickPhoto(source: PhotoSource): Promise<PhotoPickResult> {
  void source;
  return respond({ status: 'added' });
}
