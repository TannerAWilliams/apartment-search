import { timingSafeEqual } from 'node:crypto';

/** Compares two secrets in constant time, so response timing does not reveal how much matched. */
export function secretsEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
