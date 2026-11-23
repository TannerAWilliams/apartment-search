import assert from 'node:assert/strict';

/** Assert fixture setup succeeded before inspecting a nullable result. */
export function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'Expected fixture value to be present');
  return value;
}

/** Deliberately invalid input, typed as what the code under test accepts, for checking that it is rejected. */
export const malformed = <T>(value: unknown) => value as T;
