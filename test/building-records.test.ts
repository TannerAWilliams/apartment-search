import { test, expect } from 'bun:test';
import { exactBuildingAddress, retrieveBuildingRecords } from '../server/building-records.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
const address = { address: '123 MAIN STREET', city: 'Brooklyn', state: 'NY', zip: '11201' };
const bbl = '3000120004';
const building = {
  buildingid: '12345',
  boroid: '3',
  boro: 'BROOKLYN',
  housenumber: '123',
  streetname: 'MAIN STREET',
  zip: '11201',
  bin: '3000001',
  block: '12',
  lot: '4',
  recordstatus: 'Active',
};
const registered = { attributes: { bbl, zip_code: 11201, last_year_registered: 2026, registered_units: 18 } };
const annual = {
  building_id: '12345',
  bin: '3000001',
  of_dwelling_units: '20',
  infested_dwelling_unit_count: '2',
  eradicated_unit_count: '1',
  re_infested_dwelling_unit: '1',
  filing_date: '2026-01-01T00:00:00.000',
  filing_period_start_date: '2024-11-01T00:00:00.000',
  filling_period_end_date: '2025-10-31T00:00:00.000',
};
const now = new Date('2026-11-17T12:00:00Z');
/** Replacement replies from the official sources, each as JSON. */
type Overrides = {
  [K in
    | 'buildings'
    | 'violations'
    | 'complaints'
    | 'bedbugs'
    | 'dob'
    | 'requests311'
    | 'owner'
    | 'registration'
    | 'flood'
    | 'floodMetadata']?: unknown;
};
function source(override: Overrides = {}) {
  return async (url: string, options?: RequestInit) => {
    const u = new URL(url);
    if (u.hostname === 'a841-dotweb01.nyc.gov')
      return Response.json(
        u.pathname.endsWith('/7')
          ? (override.floodMetadata ?? { name: 'Current 100-Year Floodplain (2015 PFIRM)' })
          : (override.flood ?? { features: [] }),
      );
    if (u.hostname === 'services8.arcgis.com') {
      expect(u.pathname).toEndWith('/registered_buildings_unit_counts/FeatureServer/0/query');
      expect(u.searchParams.get('where')).toBe(`bbl='${bbl}' AND zip_code=11201`);
      expect(options?.redirect).toBe('manual');
      return Response.json(override.registration ?? { features: [registered] });
    }
    expect(u.origin).toBe('https://data.cityofnewyork.us');
    expect(options?.redirect).toBe('manual');
    if (u.pathname.includes('kj4p')) return Response.json(override.buildings ?? [building]);
    if (u.pathname.includes('64uk-42ks')) {
      expect(u.searchParams.get('$where')).toBe(`bbl=${bbl}`);
      return Response.json(override.owner ?? [{ bbl: bbl + '.00000000', ownername: 'EXAMPLE PROPERTY LLC', version: '26v2' }]);
    }
    if (u.pathname.includes('erm2-nwe9')) {
      expect(u.searchParams.get('$group')).toBe('complaint_type');
      expect(u.searchParams.get('$where')).toStartWith(`bbl='${bbl}' AND created_date >=`);
      return Response.json(
        override.requests311 ?? [
          { status: 'Heat / hot water', count: '3' },
          { status: 'Noise', count: '2' },
        ],
      );
    }
    if (['3h2n-5cm9', '855j-jady', '6bgk-3dad', 'eabe-havv', 'rbx6-tga4'].some((id) => u.pathname.includes(id))) {
      expect(u.searchParams.get('$where')).toStartWith("bin='3000001'");
      if (u.pathname.includes('rbx6-tga4')) expect(u.searchParams.get('$where')).toContain('issued_date <=');
      return Response.json(override.dob ?? []);
    }
    expect(u.searchParams.get('$where')).toContain('12345');
    if (u.pathname.includes('wz6d')) return Response.json(override.bedbugs ?? [annual]);
    if (u.pathname.includes('wvxf')) {
      expect(u.searchParams.get('$where')).toContain("upper(violationstatus)='OPEN'");
      return Response.json(override.violations ?? [{ count: '2' }]);
    }
    expect(u.searchParams.get('$group')).toBe('complaint_id');
    expect(u.searchParams.get('$where')).toContain('received_date <=');
    expect(u.searchParams.get('$limit')).toBe('1001');
    return Response.json(override.complaints ?? [{ complaint_id: '1' }, { complaint_id: '2' }]);
  };
}
test('exact active building match joins HPD ID and distinguishes open violations from unique complaints', async () => {
  const report = await retrieveBuildingRecords(address, source(), now);
  expect(report.status).toBe('matched');
  expect(report.identity?.buildingId).toBe('12345');
  expect(report.openViolations).toBe(2);
  expect(report.complaintsLast365Days).toBe(2);
  expect(report.checkedAt).toBe(now.toISOString());
  expect(report.requests311).toEqual({
    total: 5,
    topProblems: [
      { problem: 'Heat / hot water', count: 3 },
      { problem: 'Noise', count: 2 },
    ],
  });
  expect(report.taxLotOwner).toEqual({ bbl, name: 'EXAMPLE PROPERTY LLC', edition: '26v2' });
  expect(report.rentRegistration).toEqual({ matched: true, latestYear: 2026, registeredUnits: 18 });
});
test('missing state registrations and invalid matched tax lot responses never imply apartment status', async () => {
  const unknown = await retrieveBuildingRecords(address, source({ registration: { features: [] }, requests311: [], owner: [] }), now);
  expect(unknown.rentRegistration).toEqual({ matched: false });
  expect(unknown.taxLotOwner).toBeNull();
  expect(unknown.requests311?.total).toBe(0);
  const mismatched = await retrieveBuildingRecords(
    address,
    source({
      registration: { features: [{ attributes: { ...registered.attributes, zip_code: 11202 } }] },
      owner: [{ bbl: '3000120005', ownername: 'UNRELATED OWNER' }],
      requests311: [
        { status: 'Noise', count: '2' },
        { status: 'Noise', count: '3' },
      ],
    }),
    now,
  );
  expect(mismatched.rentRegistration).toBeNull();
  expect(mismatched.taxLotOwner).toBeNull();
  expect(mismatched.requests311).toBeNull();
  const multiple = await retrieveBuildingRecords(
    address,
    source({
      registration: {
        features: [registered, { attributes: { ...registered.attributes, last_year_registered: 2025, registered_units: 20 } }],
      },
    }),
    now,
  );
  expect(multiple.rentRegistration).toEqual({ matched: true, latestYear: 2026, registeredUnits: null });
  for (const registration of [{ error: { code: 400 } }, { exceededTransferLimit: true, features: [] }, { features: null }, []]) {
    const refused = await retrieveBuildingRecords(address, source({ registration }), now);
    expect(refused.rentRegistration).toBeNull();
    expect(refused.errors).toContain('State rent registration could not be checked.');
  }
});
test('unmatched, ambiguous and inactive/mismatched identities never query findings', async () => {
  for (const buildings of [
    [],
    [building, building],
    [{ ...building, zip: '11202' }],
    [{ ...building, buildingid: '1 OR 1=1' }],
    [{ ...building, recordstatus: 'Inactive' }],
    [{ ...building, boroid: '1' }],
  ]) {
    let calls = 0;
    const report = await retrieveBuildingRecords(
      address,
      async () => {
        calls++;
        return Response.json(buildings);
      },
      now,
    );
    expect(calls).toBe(1);
    expect(report.identity).toBeNull();
    expect(report.openViolations).toBeNull();
  }
});
test('outside jurisdiction, missing ZIP and apartment-bearing addresses fail closed without requests', async () => {
  for (const input of [
    null,
    {},
    { ...address, state: 'NJ' },
    { ...address, zip: '' },
    { ...address, county: 'New York' },
    { ...address, address: '123 MAIN STREET APT 4' },
    { ...address, address: '123 MAIN STREET #4' },
  ]) {
    expect(exactBuildingAddress(input)).toBeNull();
    expect(
      (
        await retrieveBuildingRecords(input, async () => {
          throw new Error('Must not request');
        })
      ).status,
    ).toBe('unmatched');
  }
});
test('partial failures and capped/malformed complaint results are unknown, never false zero', async () => {
  const capped = Array.from({ length: 1001 }, (_, i) => ({ complaint_id: String(i + 1) }));
  for (const complaints of [capped, [{ complaint_id: '1' }, { complaint_id: '1' }], [{}]]) {
    const report = await retrieveBuildingRecords(address, source({ complaints }), now);
    expect(report.status).toBe('partial');
    expect(report.complaintsLast365Days).toBeNull();
    expect(report.openViolations).toBe(2);
  }
  const report = await retrieveBuildingRecords(address, source({ violations: [{ count: '-1' }], complaints: [] }), now);
  expect(report.openViolations).toBeNull();
  expect(report.complaintsLast365Days).toBe(0);
});
test('official network, oversized and invalid JSON failures stay sanitized', async () => {
  for (const fetcher of [
    async () => {
      throw new Error('secret');
    },
    async () => new Response('x', { status: 429 }),
    async () => new Response('x'.repeat(262145)),
    async () => Response.json({ error: 'secret' }),
  ]) {
    const report = await retrieveBuildingRecords(address, fetcher, now);
    expect(report.status).toBe('unavailable');
    expect(JSON.stringify(report)).not.toContain('secret');
  }
});
test('HTTP API uses bounded report path and injected official transport', async () => {
  const response = await handleApi(
    new Request('https://fixture.invalid/api/building-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(address),
    }),
    {},
    { fetcher: source() },
  );
  expect(response.status).toBe(200);
  expect((await readJson<{ status: string }>(response)).status).toBe('matched');
});

test('complaint window uses NYC calendar dates and excludes future timestamps', async () => {
  const queries: string[] = [];
  const fetcher = source();
  await retrieveBuildingRecords(
    address,
    async (url: string, options?: RequestInit) => {
      queries.push(new URL(url).searchParams.get('$where') ?? '');
      return fetcher(url, options);
    },
    new Date('2026-11-17T02:00:00Z'),
  );
  expect(queries[2]).toContain("received_date <= '2026-11-16T21:00:00'");
  expect(queries[2]).toContain("received_date >= '2025-11-17T00:00:00'");
});

test('latest annual filing is owner reported, not summed, with same-date ambiguity unknown', async () => {
  const report = await retrieveBuildingRecords(
    address,
    source({ bedbugs: [annual, { ...annual, filing_date: '2025-12-01T00:00:00.000', infested_dwelling_unit_count: '9' }] }),
    now,
  );
  expect(report.bedbugs?.infested).toBe(2);
  expect(report.bedbugs?.periodEnd).toBe('2025-10-31');
  const ambiguous = await retrieveBuildingRecords(address, source({ bedbugs: [annual, annual] }), now);
  expect(ambiguous.bedbugs).toBeNull();
  expect(ambiguous.status).toBe('partial');
});
test('DOB datasets preserve separate reported statuses, never sum them or assume active', async () => {
  const report = await retrieveBuildingRecords(
    address,
    source({
      dob: [
        { status: 'Active', count: '1' },
        { status: 'Pending Dismissal', count: '2' },
      ],
    }),
    now,
  );
  expect(report.dob).toHaveLength(5);
  expect(report.dob?.[0].groups?.[1]).toEqual({ status: 'Pending Dismissal', count: 2 });
  const missing = await retrieveBuildingRecords(address, source({ buildings: [{ ...building, bin: '0' }] }), now);
  expect(missing.dob).toBeNull();
});
test('flood screen uses only official matched building point and labels preliminary layer', async () => {
  const report = await retrieveBuildingRecords(
    { ...address, latitude: 0, longitude: 0 },
    source({
      bedbugs: [{ ...annual, latitude: '40.7', longitude: '-74.01' }],
      flood: { features: [{ attributes: { FLD_ZONE: 'VE', SFHA_TF: 'T' } }] },
    }),
    now,
  );
  expect(report.flood?.point).toEqual({ latitude: 40.7, longitude: -74.01 });
  expect(report.flood?.zones).toEqual(['VE']);
  expect(report.flood?.layer).toContain('preliminary');
  const empty = await retrieveBuildingRecords(address, source({ bedbugs: [{ ...annual, latitude: '40.7', longitude: '-74.01' }] }), now);
  expect(empty.flood?.intersects).toBe(false);
  const failure = await retrieveBuildingRecords(
    address,
    source({ bedbugs: [{ ...annual, latitude: '40.7', longitude: '-74.01' }], flood: { error: { message: 'unavailable' } } }),
    now,
  );
  expect(failure.flood).toBeNull();
  expect(failure.status).toBe('partial');
});

test('impossible annual counts, duplicate DOB groups and non-SFHA zones fail conservatively', async () => {
  const bad = await retrieveBuildingRecords(
    address,
    source({
      bedbugs: [{ ...annual, infested_dwelling_unit_count: '21' }],
      dob: [
        { status: 'Active', count: '1' },
        { status: 'Active', count: '2' },
      ],
    }),
    now,
  );
  expect(bad.bedbugs).toBeNull();
  expect(bad.dob?.every((item) => item.groups === null)).toBe(true);
  const nonSfha = await retrieveBuildingRecords(
    address,
    source({
      bedbugs: [{ ...annual, latitude: '40.7', longitude: '-74.01' }],
      flood: { features: [{ attributes: { FLD_ZONE: 'X', SFHA_TF: 'F' } }] },
    }),
    now,
  );
  expect(nonSfha.flood?.intersects).toBe(false);
  expect(nonSfha.flood?.zones).toEqual(['X']);
});

test('changed flood layer edition is unknown instead of silently mislabeled', async () => {
  const report = await retrieveBuildingRecords(
    address,
    source({ bedbugs: [{ ...annual, latitude: '40.7', longitude: '-74.01' }], floodMetadata: { name: 'Future 2050 Floodplain' } }),
    now,
  );
  expect(report.flood).toBeNull();
  expect(report.status).toBe('partial');
});

test('a building whose block or lot is missing is matched without a tax lot', async () => {
  const report = await retrieveBuildingRecords(address, source({ buildings: [{ ...building, block: '' }] }), now);
  expect(report.identity?.bbl ?? null).toBeNull();
});
