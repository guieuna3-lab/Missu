import { Image } from 'expo-image';

export const mapArt = {
  campus: require('../../../assets/nearby/campus.svg'),
  chevron: require('../../../assets/nearby/chevron.svg'),
  filter: require('../../../assets/nearby/filter.svg'),
  search: require('../../../assets/nearby/search.svg'),
  place: require('../../../assets/nearby/place.svg'),
  list: require('../../../assets/nearby/list.svg'),
  locate: require('../../../assets/nearby/locate.svg'),
  accuracy: require('../../../assets/nearby/location-accuracy.svg'),
  dot: require('../../../assets/nearby/location-dot.svg'),
  markers: {
    buds: require('../../../assets/nearby/pin-buds.svg'),
    key: require('../../../assets/nearby/pin-key.svg'),
    wallet: require('../../../assets/nearby/pin-wallet.svg'),
    id: require('../../../assets/nearby/pin-id.svg'),
    bag: require('../../../assets/nearby/pin-bag.svg'),
  },
  rows: {
    buds: require('../../../assets/nearby/row-buds.svg'),
    key: require('../../../assets/nearby/row-key.svg'),
    wallet: require('../../../assets/nearby/row-wallet.svg'),
    id: require('../../../assets/nearby/row-id.svg'),
    bag: require('../../../assets/nearby/row-bag.svg'),
  },
};

export function MapIcon({
  source,
  size,
  tintColor,
}: {
  source: number;
  size: number;
  tintColor?: string;
}) {
  return (
    <Image
      accessible={false}
      source={source}
      style={{ width: size, height: size }}
      contentFit="contain"
      tintColor={tintColor}
    />
  );
}
