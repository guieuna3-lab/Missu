import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidPassword, passwordProblem } from '../src/features/auth/password.ts';

test('accepts 12+ character passwords with letters, digits and specials', () => {
  for (const text of [
    'missu2026!abc',
    'Abcdefghij1~',
    'a1' + '{'.repeat(10),
    'x9' + '-'.repeat(126),
  ])
    assert.equal(isValidPassword(text), true, text);
});

test('rejects passwords outside the rule with a specific message', () => {
  assert.match(passwordProblem('Ab1!') ?? '', /12자 이상/);
  assert.match(passwordProblem('abcdefghijkl') ?? '', /숫자·특수문자/);
  assert.match(passwordProblem('abcdefghijk1') ?? '', /특수문자를/);
  assert.equal(passwordProblem('123456789!!!'), '영문을 1개 이상 포함해 주세요.');
  assert.match(passwordProblem('미슈비밀번호입니다a1!') ?? '', /한글·공백/);
  assert.match(passwordProblem('missu 2026 pass!') ?? '', /한글·공백/);
  assert.match(passwordProblem('missu2026pass!😀') ?? '', /한글·공백/);
  assert.match(passwordProblem('a1!' + 'b'.repeat(126)) ?? '', /128자/);
});
