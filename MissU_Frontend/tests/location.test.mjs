import assert from 'node:assert/strict';
import test from 'node:test';
import { readFreshLocation, usableLocation } from '../src/features/nearby/locationFix.ts';

function fix(accuracy, timestamp = Date.now()) {
  return { coords: { latitude: 37, longitude: 127, accuracy }, timestamp };
}

test('accepts a recent device fix within the route accuracy limit', () => {
  const now = Date.now();
  assert.equal(usableLocation(fix(250, now), now), true);
  for (const accuracy of [251, null, NaN, -1])
    assert.equal(usableLocation(fix(accuracy, now), now), false);
  assert.equal(usableLocation(fix(5, now - 60000), now), false);
});

test('waits for a fresh, accurate fix and releases a late subscription', async () => {
  let releases = 0;
  let installed;
  const current = fix(8);
  const found = readFreshLocation((onFix) => {
    onFix(fix(1800));
    onFix(fix(5, Date.now() - 60000));
    onFix(current);
    return new Promise((resolve) => {
      installed = resolve;
    });
  });
  assert.equal(await found, current);
  installed({
    remove: () => {
      releases++;
    },
  });
  await Promise.resolve();
  assert.equal(releases, 1);
});

test('refines an initial laptop estimate and keeps the best later reading', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const closer = fix(45);
  const found = readFreshLocation(async (onFix) => {
    onFix(fix(149));
    onFix(closer);
    onFix(fix(90));
    return { remove() {} };
  });
  t.mock.timers.tick(4000);
  assert.equal(await found, closer);
});
