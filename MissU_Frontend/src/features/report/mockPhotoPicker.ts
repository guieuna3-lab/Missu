import { respond } from '@/lib/mockRequest';

// Stand-in for the camera / photo library picker of Figma 05.01-A. The app has no image
// picker dependency yet (expo-image-picker would be the Expo Go compatible choice), so this
// only counts photos and never returns image data. A real picker reports 'denied' when the
// OS permission is refused, which shows the 05.01-P notice.
export type PhotoSource = 'camera' | 'library';
export type PhotoPickResult = { status: 'added' } | { status: 'denied' } | { status: 'cancelled' };

export const MAX_PHOTOS = 5;

export function pickPhoto(source: PhotoSource): Promise<PhotoPickResult> {
  void source;
  return respond({ status: 'added' });
}
