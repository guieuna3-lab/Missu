import assert from 'node:assert/strict';
import test from 'node:test';
import { routeHistory } from '../src/features/nearby/routeHistory.ts';
import { routeSegments } from '../src/features/nearby/mapData.ts';

const point = (recordingId, minute, source = 'DEVICE') => ({
  id: recordingId + '-' + minute,
  recordingId,
  recordedAt: new Date(Date.UTC(2026, 10, 20, 1, minute)).toISOString(),
  lat: 37.58 + minute * 0.00001,
  lng: 127.01,
  source,
});

test('a second recording keeps the first selectable, including one-point recordings', () => {
  const first = [point('first', 0), point('first', 1)];
  const before = routeHistory(first);
  // Starting without a new GPS fix does not remove saved history.
  assert.deepEqual(routeHistory([...first]), before);
  const after = routeHistory([...first, point('second', 5)]);
  assert.equal(after.length, 2);
  assert.deepEqual(after.find((entry) => entry.id === 'first').points, first);
  assert.equal(after.find((entry) => entry.id === 'second').points.length, 1);
});

test('reloaded API results restore separate recordings in time order without mutating input', () => {
  const saved = [point('second', 8), point('first', 1), point('second', 7), point('first', 0)];
  const original = JSON.stringify(saved);
  const history = routeHistory(JSON.parse(original));
  assert.deepEqual(
    history.map((entry) => entry.id),
    ['first', 'second'],
  );
  assert.deepEqual(
    history[0].points.map((p) => p.id),
    ['first-0', 'first-1'],
  );
  assert.equal(JSON.stringify(saved), original);
});

test('all routes remain separate lines across stop/start and long signal gaps', () => {
  const points = [
    point('first', 0),
    point('first', 1),
    point('second', 2),
    point('second', 3),
    point('second', 50),
  ];
  assert.deepEqual(
    routeSegments(points).map((segment) => segment.map((p) => p.id)),
    [['first-0', 'first-1'], ['second-2', 'second-3'], ['second-50']],
  );
});

test('demo points and another day removed by the API do not leave stale history entries', () => {
  assert.deepEqual(routeHistory([point('demo', 0, 'DEMO')]), []);
  assert.equal(routeHistory([point('yesterday', 0)]).length, 1);
  assert.deepEqual(routeHistory([]), []);
});
