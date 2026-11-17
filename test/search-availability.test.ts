import { test, expect } from 'bun:test';
import { searchAvailabilityMessage } from '../src/search-availability.ts';

test('only a ready server allows an active-inventory search', () => {
  expect(searchAvailabilityMessage('ready')).toBeNull();
  for (const state of ['checking', 'offline', 'locked', 'unknown']) {
    expect(searchAvailabilityMessage(state)).toContain('previous results and destination have not changed');
  }
});
test('pending, locked and offline states provide an explicit recovery action', () => {
  expect(searchAvailabilityMessage('checking')).toContain('Wait for the connection');
  expect(searchAvailabilityMessage('locked')).toContain('Unlock');
  expect(searchAvailabilityMessage('offline')).toContain('Retry the connection');
});
