import assert from 'node:assert/strict';
import test from 'node:test';
import { placeOptions, searchPlaces } from '../src/features/place/places.ts';

test('lists every example place for an empty query and matches by name or description', () => {
  assert.equal(searchPlaces('   ').length, placeOptions.length);
  assert.deepEqual(
    searchPlaces('중앙').map((p) => p.name),
    ['중앙도서관', '중앙역'],
  );
  assert.deepEqual(
    searchPlaces('2번 출구').map((p) => p.name),
    ['중앙역'],
  );
  assert.equal(searchPlaces('강남').length, 0);
});
