/**
 * 비밀번호와 별개로, 등록자의 비공개 특징을 AES-GCM 방식으로 암호화합니다.
 * 암호화는 복원이 가능하고, digest는 세션 원문을 저장하지 않기 위한 단방향 해시입니다.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../config';

export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export const sign = (value: string) =>
  createHmac('sha256', config().signingKey).update(value).digest('hex');
export function equal(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config().piiKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    encrypted.toString('hex'),
  ].join('.');
}
export function decrypt(value: string) {
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== 'v1') throw new Error('Unsupported key version');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    config().piiKey,
    Buffer.from(iv, 'hex'),
  );
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([
    cipher.update(Buffer.from(ciphertext, 'hex')),
    cipher.final(),
  ]).toString('utf8');
}
