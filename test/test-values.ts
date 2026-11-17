import assert from 'node:assert/strict';

/** Assert fixture setup succeeded before inspecting a nullable result. */
export function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'Expected fixture value to be present');
  return value;
}
