import { test, expect } from 'bun:test';
import { inventoryExpired } from '../src/inventory-freshness.ts';
import { sourceExpiresAt } from '../server/refresh.ts';

test('expiry uses original successful observation rather than download time', () => {
  const status = {
    sources: [{ id: 'trulia-live', name: 'Trulia', checkedAt: null, status: 'updated', updatedAt: '2026-11-17T10:00:00Z' }],
  };
  expect(sourceExpiresAt(status, 'trulia-live', new Date('2026-11-17T11:59:00Z'))).toBe('2026-11-17T12:00:00.000Z');
  const result = { mode: 'live', inventoryExpiresAt: '2026-11-17T12:00:00.000Z' };
  expect(inventoryExpired(result, Date.parse('2026-11-17T12:00:00Z'))).toBe(false);
  expect(inventoryExpired(result, Date.parse('2026-11-17T12:00:00.001Z'))).toBe(true);
  expect(sourceExpiresAt(status, 'trulia-live', new Date('2026-11-17T12:00:00.001Z'))).toBeNull();
});
test('missing, failed and future observations cannot supply a fresh deadline', () => {
  expect(sourceExpiresAt(null, 'trulia-live')).toBeNull();
  expect(
    sourceExpiresAt(
      { sources: [{ id: 'trulia-live', name: 'Trulia', checkedAt: null, status: 'failed', updatedAt: '2026-11-17T10:00:00Z' }] },
      'trulia-live',
      new Date('2026-11-17T11:00:00Z'),
    ),
  ).toBeNull();
  expect(
    sourceExpiresAt(
      { sources: [{ id: 'trulia-live', name: 'Trulia', checkedAt: null, status: 'updated', updatedAt: '2026-11-18T10:00:00Z' }] },
      'trulia-live',
      new Date('2026-11-17T11:00:00Z'),
    ),
  ).toBeNull();
});
test('saved and historical views are not relabeled as expired active inventory', () => {
  expect(inventoryExpired({ mode: 'saved', inventoryExpiresAt: 'bad' })).toBe(false);
  expect(inventoryExpired({ mode: 'snapshot', inventoryExpiresAt: 'bad' })).toBe(false);
  expect(inventoryExpired({ mode: 'live' })).toBe(false);
  expect(inventoryExpired({ mode: 'live', inventoryExpiresAt: 'bad' })).toBe(true);
});
