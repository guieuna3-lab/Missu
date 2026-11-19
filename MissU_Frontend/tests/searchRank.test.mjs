import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceOf, formatDistance, sortResults } from '../src/lib/searchRank.ts';

const near = { lat: 37.5884, lng: 127.006, label: '한성대입구역' };
const filters = { query: '이어폰', period: 'all', place: '', near };
const member = (id, name, point, foundAt = '2026-11-10T10:00:00+09:00') => ({
  id,
  name,
  description: '',
  category: 'ELECTRONICS',
  photos: 0,
  foundAt,
  location: '',
  storage: '',
  collectionGuide: '',
  ...(point && { point }),
});
const agency = (id, name, distanceM, date = '2026-11-12') => ({
  id,
  name,
  source: '지하철',
  date,
  dateLabel: '습득일',
  storage: '혜화역(4호선)',
  reference: '',
  url: '',
  category: 'OTHER',
  ...(distanceM !== undefined && { distanceM }),
});

test('distance sort puts unknown locations last and keeps newest first on ties', () => {
  const items = [
    agency('far', '버즈', 1400),
    member('none', '이어폰'),
    member('close', '이어폰', { lat: 37.5885, lng: 127.0061 }),
    agency('mid', '에어팟', 620),
  ];
  const sorted = sortResults(items, 'distance', filters).map((i) => i.id);
  assert.deepEqual(sorted, ['close', 'mid', 'far', 'none']);
  assert.equal(distanceOf(items[1], near), undefined);
  assert.equal(distanceOf(items[0], undefined), undefined);
});

test('recent and relevance preserve the globally ranked server pages', () => {
  const items = [
    agency('old', '이어폰', undefined, '2026-11-01'),
    agency('new', '이어폰', undefined, '2026-11-15'),
    agency('other', '에어팟', undefined, '2026-11-16'),
  ];
  assert.equal(sortResults(items, 'relevance', filters), items);
  assert.equal(sortResults(items, 'recent', filters), items);
});

test('distance labels round to readable units', () => {
  assert.equal(formatDistance(48), '50m');
  assert.equal(formatDistance(3), '10m');
  assert.equal(formatDistance(1420), '1.4km');
});
