import { test, expect } from 'bun:test';
import { buildingRequestIdentity, createBuildingReportCache } from '../src/building-report-cache.ts';
const listing = { address: '123 Test St', city: 'Brooklyn', county: 'Kings', state: 'NY', zip: '11201' };
const report = { status: 'matched', checkedAt: '2026-11-17T12:00:00Z', identity: { buildingId: '1' } };
test('completed report cache expires after five minutes and returns isolated copies', async () => {
  let now = 0, calls = 0; const load = createBuildingReportCache(() => now); const request = async () => { calls++; return report; }; const signal = new AbortController().signal;
  const first = await load(listing, request, signal); first.identity.buildingId = 'tampered';
  expect((await load(listing, request, signal)).identity.buildingId).toBe('1'); expect(calls).toBe(1);
  now = 300001; await load(listing, request, signal); expect(calls).toBe(2);
});
test('canceled late response cannot populate cache; different counties isolate identities', async () => {
  const load = createBuildingReportCache(); const controller = new AbortController(); let finish: (value: typeof report) => void = () => { throw new Error('Fixture promise not initialized'); };
  const pending = load(listing, () => new Promise<typeof report>(resolve => { finish = resolve; }), controller.signal);
  controller.abort(); finish(report); await expect(pending).rejects.toThrow();
  let calls = 0; await load(listing, async () => { calls++; return report; }, new AbortController().signal); expect(calls).toBe(1);
  expect(buildingRequestIdentity(listing)).not.toBe(buildingRequestIdentity({ ...listing, county: 'Queens' }));
});
test('unknown responses expire sooner and invalid/failed responses are never cached', async () => {
  let now = 0, calls = 0; const load = createBuildingReportCache(() => now); const signal = new AbortController().signal;
  const request = async () => { calls++; return { ...report, status: 'unavailable' }; };
  await load(listing, request, signal); now = 30001; await load(listing, request, signal); expect(calls).toBe(2);
  await expect(load({ ...listing, address: 'other' }, async () => ({}), signal)).rejects.toThrow();
});
