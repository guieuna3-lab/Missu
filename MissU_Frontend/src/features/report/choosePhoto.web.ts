import { api, ApiError } from '@/lib/backend';
import type { PhotoSource } from './mockPhotoPicker';

// 브라우저의 사진 선택기를 열고 촬영한 사진의 메타데이터를 제외한 JPEG만 전송합니다.
export async function choosePhoto(source: PhotoSource, token: string | null) {
  if (!token) throw new ApiError(401, '로그인이 필요합니다.');
  const file = await new Promise<File | undefined>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (source === 'camera') input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files?.[0]);
    input.oncancel = () => resolve(undefined);
    input.click();
  });
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) throw new ApiError(400, '25MB 이하의 사진을 선택해 주세요.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new ApiError(400, '이 사진을 열 수 없어요. JPEG 또는 PNG 사진을 골라 주세요.');
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ApiError(400, '사진을 처리하지 못했어요.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.83),
    );
    if (!blob) throw new ApiError(400, '사진을 처리하지 못했어요.');
    const data = new FormData();
    data.append('file', blob, 'item.jpg');
    const result = await api<{ data: { photoId: string } }>('/uploads', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: data,
    });
    canvas.width = 120;
    canvas.height = Math.max(1, Math.round((120 * image.height) / image.width));
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { id: result.data.photoId, preview: canvas.toDataURL('image/jpeg', 0.7) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
