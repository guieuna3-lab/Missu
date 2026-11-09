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
};
export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  const size = name === 'pin' ? 20 : ['heart', 'child', 'shield'].includes(name) ? 14 : 24;
  return (
    <Image
      source={icons[name]}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessible={false}
    />
  );
}
