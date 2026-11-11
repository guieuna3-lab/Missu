import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '@/lib/backend';
import type { PhotoSource } from './mockPhotoPicker';

export async function choosePhoto(source: PhotoSource, token: string | null) {
  if (!token) throw new ApiError(401, '로그인이 필요합니다.');
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted)
    throw new ApiError(403, '기기 설정에서 카메라 접근을 허용해 주세요.');
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return;

  // 서버가 받는 JPEG로 맞추고 네트워크로 보내는 사진의 크기를 줄입니다.
  const asset = result.assets[0];
  const context = ImageManipulator.manipulate(asset.uri);
  let preview: string;
  try {
    if (Math.max(asset.width, asset.height) > 1600)
      context.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
    const image = await context.renderAsync();
    try {
      preview = (await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 })).uri;
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
  const body = new FormData();
  body.append('file', { uri: preview, name: 'item.jpg', type: 'image/jpeg' } as unknown as Blob);
  const response = await api<{ data: { photoId: string } }>('/uploads', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body,
  });
  return { id: response.data.photoId, preview };
}
