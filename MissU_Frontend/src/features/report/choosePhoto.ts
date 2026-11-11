import { ApiError } from '@/lib/backend';
import type { PhotoSource } from './mockPhotoPicker';
// 이 릴리스의 사진 선택은 휴대폰 웹 브라우저에서 제공됩니다.
export async function choosePhoto(
  _source: PhotoSource,
  _token: string | null,
): Promise<{ id: string; preview: string } | undefined> {
  void _source;
  void _token;
  throw new ApiError(400, '휴대폰 브라우저의 미슈 주소에서 사진을 선택해 주세요.');
}
