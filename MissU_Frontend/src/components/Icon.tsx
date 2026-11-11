import { Image } from 'expo-image';

const icons = {
  pin: require('../../assets/icons/pin.svg'),
  heart: require('../../assets/icons/heart.svg'),
  child: require('../../assets/icons/child.svg'),
  shield: require('../../assets/icons/shield.svg'),
  buds: require('../../assets/icons/buds.svg'),
  key: require('../../assets/icons/key.svg'),
  wallet: require('../../assets/icons/wallet.svg'),
  home: require('../../assets/icons/home.svg'),
  'home-active': require('../../assets/icons/home-active.svg'),
  map: require('../../assets/icons/map.svg'),
  'map-active': require('../../assets/nearby/nav-active.svg'),
  edit: require('../../assets/icons/edit.svg'),
  'edit-active': require('../../assets/icons/edit-active.svg'),
  user: require('../../assets/icons/user.svg'),
  'user-active': require('../../assets/icons/user-active.svg'),
  lock: require('../../assets/icons/lock.svg'),
  back: require('../../assets/icons/back.svg'),
  search: require('../../assets/icons/search.svg'),
  // Item categories (04.02, 05.01) reuse the nearby row art for bag and id.
  bag: require('../../assets/nearby/row-bag.svg'),
  id: require('../../assets/nearby/row-id.svg'),
  box: require('../../assets/icons/box.svg'),
  camera: require('../../assets/icons/camera.svg'),
  check: require('../../assets/icons/check.svg'),
  book: require('../../assets/icons/book.svg'),
  bus: require('../../assets/icons/bus.svg'),
};
export type IconName = keyof typeof icons;

export function Icon({
  name,
  size: sizeOverride,
  tintColor,
}: {
  name: IconName;
  size?: number;
  /** Recolors the whole glyph, such as white on a selected map pin. */
  tintColor?: string;
}) {
  const size =
    sizeOverride ?? (name === 'pin' ? 20 : ['heart', 'child', 'shield'].includes(name) ? 14 : 24);
  return (
    <Image
      source={icons[name]}
      style={{ width: size, height: size }}
      contentFit="contain"
      tintColor={tintColor}
      accessible={false}
    />
  );
}
