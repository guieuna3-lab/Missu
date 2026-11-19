import { alertItemSearch, matchesName } from '../items/item-search';
import { distance, koreaDay } from '../items/institution-records';

export type MatchReport = {
  name: string;
  category: string;
  lostStart: Date;
  userId: string;
  lat: number;
  lng: number;
  place: string;
};
export type MatchItem = {
  id: string;
  name: string;
  category: string;
  day: string;
  owner?: string;
  lat?: number;
  lng?: number;
  place?: string;
  storage?: string;
};

// 색상만 같은 물품은 알리지 않습니다. 검색과 같은 동의어·기종·액세서리 구분을 사용합니다.
export function similarItem(report: MatchReport, item: MatchItem) {
  if (
    item.owner === report.userId ||
    item.day < koreaDay(report.lostStart.getTime())
  )
    return false;
  const name = report.name
    .replace(
      /검정색|검은색|검정|검은|블랙|흰색|하얀색|화이트|빨간색|파란색|분홍색|갈색|남색|작은|분실물|분실/gu,
      ' ',
    )
    .trim();
  if (!name) return false;
  if (!matchesName(alertItemSearch(name), item.name)) return false;
  const normalized = (s: string) =>
    s.normalize('NFKC').toLowerCase().replace(/\s/g, '');
  const landmark = report.place.match(
    /[가-힣A-Za-z0-9·]+(?:역|대학교|공항|터미널|경찰서|지구대|파출소)|한성대/u,
  )?.[0];
  const key = normalized(landmark || report.place);
  const samePlace =
    key.length >= 2 &&
    normalized((item.place ?? '') + ' ' + (item.storage ?? '')).includes(key);
  return (
    samePlace ||
    (Number.isFinite(item.lat) &&
      Number.isFinite(item.lng) &&
      distance(report, { lat: item.lat!, lng: item.lng! }) <= 3000)
  );
}
