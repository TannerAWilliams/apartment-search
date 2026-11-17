import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { syncStreetEasy } from '../scripts/sync-streeteasy.ts';
for (const state of ['missing', 'stale', 'current']) test('external runner handles ' + state + ' inventory with injected offline transport', async () => {
  let imported = false;
  const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
  const fetcher = async (url: string, options?: RequestInit) => {
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

test('external runner rejects missing, invalid and stale verification timestamps', async () => {
  for (const updatedAt of [undefined, 'not-a-date', '2000-01-01T00:00:00.000Z']) {
    let imported = false;
    const fetcher = async (url: string) => {
      if (url === 'https://api-v6.streeteasy.com/') return Response.json({ data: { searchRentals: { totalCount: 0, edges: [] } } });
      assert.ok(url.startsWith('https://synthetic.example.invalid/api/'));
      if (url.endsWith('/api/refresh')) { imported = true; return Response.json({ state: 'complete' }); }
      return Response.json({ refresh: { sources: imported ? [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', total: 0, listingCount: 0, updatedAt }] : [] } });
    };
    await assert.rejects(syncStreetEasy({ token: 'synthetic-test-token', origin: 'https://synthetic.example.invalid', fetcher }), /not verified/);
    assert.equal(imported, true);
  }
});
