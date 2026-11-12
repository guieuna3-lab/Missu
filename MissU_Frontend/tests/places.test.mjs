import assert from 'node:assert/strict';
import test from 'node:test';
import { placePins } from '../src/features/place/places.ts';

test('uses the coordinates of each search result and saved place', () => {
  const result = { id: 'result', name: '서울시청', lat: 37.5666, lng: 126.9784 };
  const saved = { id: 'previous', name: '예전 장소', lat: 37.58, lng: 127.011 };
  assert.deepEqual(placePins([result, saved]), [
    { id: result.id, title: result.name, lat: result.lat, lng: result.lng },
    { id: saved.id, title: saved.name, lat: saved.lat, lng: saved.lng },
  ]);
});
test('only draws the current location after valid device coordinates arrive', () => {
  const current = { id: 'current', name: '현재 위치' };
  assert.deepEqual(
    placePins([current, { ...current, lat: NaN, lng: 127 }, { ...current, lat: 95, lng: 0 }]),
    [],
  );
  assert.deepEqual(placePins([{ ...current, lat: 0, lng: 0 }]), [
    { id: 'current', title: '현재 위치', lat: 0, lng: 0 },
  ]);
});
