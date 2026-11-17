import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { syncStreetEasy } from '../scripts/sync-streeteasy.ts';
for (const state of ['missing', 'stale', 'current']) test('external runner handles ' + state + ' inventory with injected offline transport', async () => {
  let imported = false;
  const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
  const fetcher = async (url, options) => {
    if (String(url) === 'https://api-v6.streeteasy.com/') {
      assert.notEqual(state, 'current', 'Current data must not be fetched');
      return Response.json({ data: { searchRentals: { totalCount: 0, edges: [] } } });
    }
    assert.ok(String(url).startsWith('https://synthetic.example.invalid/api/'), 'Unknown endpoint must not escape fixture');
    if (String(url).endsWith('/api/refresh')) { imported = true; return Response.json({ state: 'complete' }); }
    const now = new Date().toISOString();
    const sources = imported ? [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', total: 0, listingCount: 0, updatedAt: now }] :
      state === 'missing' ? [] : [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', total: 0, listingCount: 0, updatedAt: state === 'current' ? now : old }];
    return Response.json({ refresh: { sources } });
  };
  const result = await syncStreetEasy({ token: 'synthetic-test-token', origin: 'https://synthetic.example.invalid', fetcher: fetcher as typeof fetch });
  assert.equal(result.state, state === 'current' ? 'already_current' : 'updated');
});
test('offline test guard denies unmocked external requests before transport', () => {
  assert.throws(() => fetch('https://must-not-be-contacted.example.invalid'), /Offline test guard/);
});
