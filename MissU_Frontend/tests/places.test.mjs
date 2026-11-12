import assert from 'node:assert/strict';
import test from 'node:test';
import { devicePlaceLabel, isCurrentLocationLabel } from '../src/lib/placeAddress.ts';
import { fromServer } from '../src/lib/items.ts';
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

test('device addresses keep the road or parcel address with user-entered floor details', () => {
  const address = '서울 중구 세종대로 110';
  assert.equal(devicePlaceLabel(address, address), address);
  assert.equal(devicePlaceLabel(address, ' 1층 안내소 '), address + ' · 1층 안내소');
  assert.equal(devicePlaceLabel(address, address + ' 1층'), address + ' 1층');
  assert.equal(devicePlaceLabel(undefined, '시청 서문'), '시청 서문');
  assert.equal(devicePlaceLabel(undefined, ' 현재위치 '), '');
  assert.equal(isCurrentLocationLabel('현재 위치'), true);
  assert.equal(isCurrentLocationLabel('현재 위치 옆 서문'), false);
});

test('only placeholder items ask for a legacy address on detail', () => {
  const row = {
    id: 'fixture',
    name: '지갑',
    photos: [],
    foundLocation: { ...{ lat: 37.5666, lng: 126.9784 }, label: '현재위치' },
  };
  assert.deepEqual(fromServer(row).legacyLocation, { lat: 37.5666, lng: 126.9784 });
  assert.equal(
    fromServer({ ...row, foundLocation: { ...row.foundLocation, label: '1층 안내소' } })
      .legacyLocation,
    undefined,
  );
});
