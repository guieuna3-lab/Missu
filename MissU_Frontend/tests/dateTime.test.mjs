import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDate,
  formatDateTime,
  formatDateTimeRange,
  formatTime,
  isTimeText,
  normalizeTimeText,
  parseDate,
  parseDateTime,
} from '../src/lib/dateTime.ts';

test('parses the Figma date-time text as Seoul time', () => {
  assert.equal(parseDateTime('2026.10.06 14:00'), '2026-10-06T14:00:00+09:00');
  assert.equal(parseDateTime(' 2026-10-06 9:05 '), '2026-10-06T09:05:00+09:00');
  assert.equal(parseDateTime('2026.10.06 · 14:20'), '2026-10-06T14:20:00+09:00');
  assert.equal(parseDate('2026.10.06'), '2026-10-06T00:00:00+09:00');
});

test('rejects malformed or impossible dates', () => {
  for (const text of [
    '',
    '10.06 14:00',
    '2026.13.01 10:00',
    '2026.02.30 10:00',
    '2026.10.06 24:00',
  ])
    assert.equal(parseDateTime(text), null, text);
  assert.equal(parseDate('2026.10.06 14:00'), null);
});

test('formats ISO values in Seoul time regardless of the device zone', () => {
  assert.equal(formatDateTime('2026-10-06T05:20:00Z'), '2026.10.06 14:20');
  assert.equal(formatDate('2026-10-06T14:20:00+09:00'), '2026.10.06');
  assert.equal(formatTime('2026-10-06T14:20:00+09:00'), '14:20');
  assert.equal(formatDateTime('not a date'), '');
});

test('formats a lost-time range like 04.05 and 08.01', () => {
  const from = '2026-10-06T14:00:00+09:00';
  assert.equal(formatDateTimeRange(from, '2026-10-06T18:00:00+09:00'), '2026.10.06 14:00~18:00');
  assert.equal(formatDateTimeRange(from, from), '2026.10.06 14:00');
  assert.equal(formatDateTimeRange(from), '2026.10.06 14:00');
  assert.equal(
    formatDateTimeRange(from, '2026-10-07T01:00:00+09:00'),
    '2026.10.06 14:00 ~ 2026.10.07 01:00',
  );
});

test('validates appointment time text', () => {
  assert.equal(isTimeText('17:00'), true);
  assert.equal(isTimeText('9:05'), true);
  assert.equal(isTimeText('25:00'), false);
  assert.equal(isTimeText('17시'), false);
  assert.equal(normalizeTimeText('9:05'), '09:05');
});
