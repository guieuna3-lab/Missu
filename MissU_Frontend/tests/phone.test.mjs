import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPhone,
  isPhoneNumber,
  maskPhone,
  normalizePhone,
} from '../src/features/verify/phone.ts';

test('accepts Korean mobile numbers with or without separators', () => {
  for (const text of ['010-1234-5678', '01012345678', '010 1234 5678', '011-234-5678'])
    assert.equal(isPhoneNumber(text), true, text);
  for (const text of ['', '010-1234', '02-123-4567', '0101234567890', '010-abcd-5678'])
    assert.equal(isPhoneNumber(text), false, text);
});

test('formats and masks the number like the 07 screens', () => {
  assert.equal(normalizePhone('010-1234-5678'), '01012345678');
  assert.equal(formatPhone('01012345678'), '010-1234-5678');
  assert.equal(formatPhone('0112345678'), '011-234-5678');
  assert.equal(maskPhone('01012345678'), '010-****-5678');
  assert.equal(maskPhone('123'), '123');
});
