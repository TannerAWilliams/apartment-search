import { test, expect } from 'bun:test';
import { exactBuildingAddress, retrieveBuildingRecords } from '../server/building-records.ts';
import { handleApi } from '../server/api.ts';
const address = { address: '123 MAIN STREET', city: 'Brooklyn', state: 'NY', zip: '11201' };
const building = { buildingid: '12345', boroid: '3', boro: 'BROOKLYN', housenumber: '123', streetname: 'MAIN STREET', zip: '11201', bin: '3000001', recordstatus: 'Active' };
const now = new Date('2026-11-17T12:00:00Z');
function source(override: { buildings?: any; violations?: any; complaints?: any } = {}) {
  return async (url: string, options?: RequestInit) => {
    const u = new URL(url); expect(u.origin).toBe('https://data.cityofnewyork.us'); expect(options?.redirect).toBe('error');
    if (u.pathname.includes('kj4p')) return Response.json(override.buildings ?? [building]);
    expect(u.searchParams.get('$where')).toContain('12345');
    if (u.pathname.includes('wvxf')) { expect(u.searchParams.get('$where')).toContain("upper(violationstatus)='OPEN'"); return Response.json(override.violations ?? [{ count: '2' }]); }
    expect(u.searchParams.get('$group')).toBe('complaint_id');
    expect(u.searchParams.get('$where')).toContain('received_date <='); expect(u.searchParams.get('$limit')).toBe('1001');
    return Response.json(override.complaints ?? [{ complaint_id: '1' }, { complaint_id: '2' }]);
  };
}
test('exact active building match joins HPD ID and distinguishes open violations from unique complaints', async () => {
  const report = await retrieveBuildingRecords(address, source(), now);
  expect(report.status).toBe('matched'); expect(report.identity?.buildingId).toBe('12345');
  expect(report.openViolations).toBe(2); expect(report.complaintsLast365Days).toBe(2); expect(report.checkedAt).toBe(now.toISOString());
});
test('unmatched, ambiguous and inactive/mismatched identities never query findings', async () => {
  for (const buildings of [[], [building, building], [{ ...building, zip: '11202' }], [{ ...building, buildingid: '1 OR 1=1' }], [{ ...building, recordstatus: 'Inactive' }], [{ ...building, boroid: '1' }]]) {
    let calls = 0;
    const report = await retrieveBuildingRecords(address, async () => { calls++; return Response.json(buildings); }, now);
    expect(calls).toBe(1); expect(report.identity).toBeNull(); expect(report.openViolations).toBeNull();
  }
});
test('outside jurisdiction, missing ZIP and apartment-bearing addresses fail closed without requests', async () => {
  for (const input of [null, {}, { ...address, state: 'NJ' }, { ...address, zip: '' }, { ...address, county: 'New York' }, { ...address, address: '123 MAIN STREET APT 4' }, { ...address, address: '123 MAIN STREET #4' }]) {
    expect(exactBuildingAddress(input)).toBeNull();
    expect((await retrieveBuildingRecords(input, async () => { throw new Error('Must not request'); })).status).toBe('unmatched');
  }
});
test('partial failures and capped/malformed complaint results are unknown, never false zero', async () => {
  const capped = Array.from({ length: 1001 }, (_, i) => ({ complaint_id: String(i + 1) }));
  for (const complaints of [capped, [{ complaint_id: '1' }, { complaint_id: '1' }], [{}]]) {
    const report = await retrieveBuildingRecords(address, source({ complaints }), now);
    expect(report.status).toBe('partial'); expect(report.complaintsLast365Days).toBeNull(); expect(report.openViolations).toBe(2);
  }
  const report = await retrieveBuildingRecords(address, source({ violations: [{ count: '-1' }], complaints: [] }), now);
  expect(report.openViolations).toBeNull(); expect(report.complaintsLast365Days).toBe(0);
});
test('official network, oversized and invalid JSON failures stay sanitized', async () => {
  for (const fetcher of [async () => { throw new Error('secret'); }, async () => new Response('x', { status: 429 }), async () => new Response('x'.repeat(262145)), async () => Response.json({ error: 'secret' })]) {
    const report = await retrieveBuildingRecords(address, fetcher, now);
    expect(report.status).toBe('unavailable'); expect(JSON.stringify(report)).not.toContain('secret');
  }
});
test('HTTP API uses bounded report path and injected official transport', async () => {
  const response = await handleApi(new Request('https://fixture.invalid/api/building-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(address) }), {}, { fetcher: source() });
  expect(response.status).toBe(200); expect((await response.json()).status).toBe('matched');
});

test('complaint window uses NYC calendar dates and excludes future timestamps', async () => {
  const queries: string[] = [];
  const fetcher = source();
  await retrieveBuildingRecords(address, async (url, options) => { queries.push(new URL(url).searchParams.get('$where') ?? ''); return fetcher(url, options); }, new Date('2026-11-17T02:00:00Z'));
  expect(queries[2]).toContain("received_date <= '2026-11-16T21:00:00'");
  expect(queries[2]).toContain("received_date >= '2025-11-17T00:00:00'");
});
