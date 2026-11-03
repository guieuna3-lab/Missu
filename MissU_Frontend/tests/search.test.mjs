import assert from 'node:assert/strict';
import test from 'node:test';
import { filterItems, formatFoundAt, mockItems } from '../src/features/search/items.ts';

const now = new Date('2026-10-07T14:20:00+09:00').getTime();
const base = { query: '이어폰', period: 'all', place: '' };
test('searches public descriptions as well as item names', () => {
  assert.deepEqual(
    filterItems(mockItems, base, now).map((i) => i.id),
    ['buds'],
  );
});
test('all words must match; whitespace and letter case are normalized', () => {
  assert.deepEqual(
    filterItems(mockItems, { ...base, query: '  검정   이어폰  ' }, now).map((i) => i.id),
    ['buds'],
  );
  assert.equal(filterItems(mockItems, { ...base, query: '검정 지갑 이어폰' }, now).length, 0);
});
test('combines location and time filters, including the seven-day boundary', () => {
  const atBoundary = new Date(mockItems[0].foundAt).getTime() + 7 * 86400000;
  assert.equal(
    filterItems(mockItems, { ...base, period: '7', place: '도서관' }, atBoundary).length,
    1,
  );
  assert.equal(filterItems(mockItems, { ...base, period: '7' }, atBoundary + 1).length, 0);
  assert.equal(filterItems(mockItems, { ...base, place: '학생식당' }, now).length, 0);
});
test('does not include future records or mutate the source list', () => {
  const before = JSON.stringify(mockItems);
  assert.equal(filterItems(mockItems, base, 0).length, 0);
  assert.equal(JSON.stringify(mockItems), before);
});
test('resetting period and location restores matches', () => {
  assert.equal(filterItems(mockItems, { ...base, period: '7', place: '공학관' }, now).length, 0);
  assert.equal(filterItems(mockItems, base, now).length, 1);
});
test('formats timestamps consistently in Seoul time', () => {
  assert.equal(formatFoundAt('2026-10-06T05:20:00Z'), '2026.10.06 14:20');
});
