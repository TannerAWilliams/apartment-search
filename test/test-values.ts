import { expect } from 'bun:test';

/** Assert fixture setup succeeded before inspecting a nullable result. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected fixture value to be present');
  return value;
}

/** The value, checked to be an instance of the class, typed as one. */
export function instanceOf<T>(value: unknown, type: abstract new (...args: never[]) => T): T {
  expect(value).toBeInstanceOf(type);
  return value as T;
}

/** The error a promise rejects with; fails if it resolves instead. */
export async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

/** Deliberately invalid input, typed as what the code under test accepts, for checking that it is rejected. */
export const malformed = <T>(value: unknown) => value as T;
