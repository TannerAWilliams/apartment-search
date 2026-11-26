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
/** Evictions by tax lot, as the app loads them once for every building. */
const evicted = { since: '2024-11-17', lots: { [bbl]: 3 } };
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
    | 'rodents'
    | 'vacate'
    | 'crime'
    | 'parks'
    | 'stores'
    | 'court'
    | 'hpdRegistration'
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
    // The block: read around the tax lot's own point.
    if (u.hostname === 'data.ny.gov') {
      expect(u.searchParams.get('$where')).toBe('within_circle(georeference, 40.7, -73.99, 400)');
      return Response.json(
        override.stores ?? [
          { dba_name: 'KEY FOOD', square_footage: '12000' },
          { dba_name: 'CORNER DELI', square_footage: '900' },
          { dba_name: 'TRADER JOES', square_footage: '15000' },
          { dba_name: 'CVS PHARMACY 02036', square_footage: '11000' },
          { square_footage: '9000' },
        ],
      );
    }
    expect(u.origin).toBe('https://data.cityofnewyork.us');
    if (u.pathname.includes('5uac-w243')) {
      expect(u.searchParams.get('$where')).toBe('within_circle(lat_lon, 40.7, -73.99, 200)');
      return Response.json(
        override.crime ?? [
          { status: 'GRAND LARCENY', count: '6' },
          { status: 'ROBBERY', count: '2' },
          { status: 'ASSAULT 3 & RELATED OFFENSES', count: '1' },
          { status: 'HARRASSMENT 2', count: '4' },
        ],
      );
    }
    if (u.pathname.includes('enfh-gkve'))
      return Response.json(
        override.parks ?? [{ signname: 'Pocket Park', acres: '0.4' }, { signname: 'Big Park', acres: '85' }, { acres: '3' }],
      );
    if (u.pathname.includes('tb8q-a3ar')) {
      expect(u.searchParams.get('$where')).toBe("building_id='12345'");
      return Response.json(override.vacate ?? []);
    }
    expect(options?.redirect).toBe('manual');
    if (u.pathname.includes('kj4p')) return Response.json(override.buildings ?? [building]);
    if (u.pathname.includes('64uk-42ks')) {
      expect(u.searchParams.get('$where')).toBe(`bbl=${bbl}`);
      return Response.json(
        override.owner ?? [
          {
            bbl: bbl + '.00000000',
            ownername: 'EXAMPLE PROPERTY LLC',
            version: '26v2',
            unitsres: '20',
            resarea: '15000',
            latitude: '40.7',
            longitude: '-73.99',
          },
        ],
      );
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
    // Read over two years, on the tax lot or the building.
    if (u.pathname.includes('p937-wjvj')) {
      expect(u.searchParams.get('$where')).toStartWith(`bbl='${bbl}' AND inspection_date >= '`);
      return Response.json(
        override.rodents ?? [
          { status: 'Passed', count: '4' },
          { status: 'Rat Activity', count: '1' },
          { status: 'Failed for Rat Activity and Other Reason', count: '2' },
        ],
      );
    }
    if (u.pathname.includes('59kj-x8nc')) {
      expect(u.searchParams.get('$where')).toStartWith("buildingid='12345' AND caseopendate >= '");
      return Response.json(
        override.court ?? [
          { status: 'Heat and Hot Water', count: '1' },
          { status: 'Tenant Action/Harrassment', count: '2' },
        ],
      );
    }
    if (u.pathname.includes('tesw-yqqr')) {
      expect(u.searchParams.get('$order')).toBe('registrationenddate DESC');
      return Response.json(override.hpdRegistration ?? [{ buildingid: '12345', registrationenddate: '2027-09-01T00:00:00.000' }]);
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
  expect(report.taxLotOwner).toEqual({
    bbl,
    name: 'EXAMPLE PROPERTY LLC',
    edition: '26v2',
    units: 20,
    averageSquareFeet: 750,
    point: { latitude: 40.7, longitude: -73.99 },
  });
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
  const complaints = queries.find((where) => where.includes('received_date'))!;
  expect(complaints).toContain("received_date <= '2026-11-16T21:00:00'");
  expect(complaints).toContain("received_date >= '2025-11-17T00:00:00'");
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

test('a building opened in Details is kept as short facts, and the nightly step checks the next listed buildings', async () => {
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  const { fillBuildingFacts, readBuildingFacts, summarizeReport } = await import('../server/building-facts.ts');
  const { buildingKey } = await import('../src/listings.ts');
  const bucket = createMemoryBucket();
  const response = await handleApi(
    new Request('https://app.test/api/building-report', {
      method: 'POST',
      body: JSON.stringify(address),
      headers: { 'Content-Type': 'application/json' },
    }),
    { BUCKET: bucket },
    { fetcher: source() },
  );
  expect(response.status).toBe(200);
  const key = buildingKey(address)!;
  expect((await readBuildingFacts(bucket))[key]).toMatchObject({ stabilized: true, openViolations: 2, complaints: 2, bedbugs: true });
  expect(summarizeReport({ ...(await retrieveBuildingRecords({ address: 'x' }, source(), now)) })).toBeNull();

  // Nightly: NYC buildings without fresh facts, one check each; the one just recorded is skipped.
  const listing = (id: string, street: string, region = 'nyc') => ({
    id,
    address: street,
    city: 'Brooklyn',
    state: 'NY',
    zip: '11201',
    region,
    rent: 3000,
    bedrooms: 1,
    kind: 'feed',
    sources: [],
  });
  const listings = [
    listing('a', '123 Main Street'),
    listing('b', '9 Other Street'),
    listing('c', '9 Other Street'),
    listing('d', '1 Far Road', 'nj'),
  ];
  let requests = 0;
  const counting = async (url: string, options?: RequestInit) => {
    requests++;
    return source({ buildings: [] })(url, options);
  };
  expect(await fillBuildingFacts(bucket, listings, counting, { now })).toBe(1);
  expect(requests, 'one identity lookup for the one unknown NYC building').toBe(1);
  const facts = await readBuildingFacts(bucket);
  expect(facts[buildingKey({ address: '9 Other Street', state: 'NY', zip: '11201' })!]).toMatchObject({ stabilized: null });
  expect(await fillBuildingFacts(bucket, listings, counting, { now }), 'nothing left to check').toBe(0);
  const later = new Date(now.getTime() + 100 * 86_400_000);
  expect(
    await fillBuildingFacts(bucket, listings, counting, { now: later, limit: 1 }),
    'old facts are checked again, up to the limit',
  ).toBe(1);
  const broken = async () => {
    throw new Error('down');
  };
  expect(await fillBuildingFacts(createMemoryBucket(), listings, broken as never, { now }), 'an unreachable city still counts').toBe(2);
});

test('rat inspections, evictions, Housing Court cases and HPD registration are read over two years and kept apart', async () => {
  const queries: Record<string, string> = {};
  const fetcher = source();
  const report = await retrieveBuildingRecords(
    address,
    async (url, options) => {
      const u = new URL(url);
      queries[u.pathname.split('/').at(-1)!.replace('.json', '')] = u.searchParams.get('$where') ?? '';
      return fetcher(url, options);
    },
    now,
    undefined,
    evicted,
  );
  expect(report.status).toBe('matched');
  // Two years to the day in New York, and nothing dated after now.
  expect(queries['p937-wjvj']).toBe(
    `bbl='${bbl}' AND inspection_date >= '2024-11-18T00:00:00' AND inspection_date <= '2026-11-17T07:00:00'`,
  );
  // Evictions are counted from the app's own copy of the city's list, not asked about one building at a time.
  expect(queries['6z8x-wfk4']).toBeUndefined();
  expect(report.evictionsSince).toBe('2024-11-17');
  expect(queries['59kj-x8nc']).toContain("caseopendate >= '2024-11-18T00:00:00' AND caseopendate <= '2026-11-17T07:00:00'");
  expect(report.sinceTwoYears).toBe('2024-11-18');
  // Inspections that found rats are counted whatever else they found.
  expect(report.rodents).toEqual({ inspections: 7, ratActivity: 3 });
  expect(report.evictions).toBe(3);
  expect(report.housingCourt).toEqual({
    cases: 3,
    harassment: 2,
    kinds: [
      { kind: 'Tenant Action/Harrassment', count: 2 },
      { kind: 'Heat and Hot Water', count: 1 },
    ],
  });
  expect(report.hpdRegistration).toEqual({ current: true, through: '2027-09-01' });

  // None of them on file is a finding of none; a lapsed or missing registration is said, with its last date.
  const quiet = await retrieveBuildingRecords(
    address,
    source({
      rodents: [],
      court: [],
      hpdRegistration: [{ buildingid: '12345', registrationenddate: '2025-09-01T00:00:00.000' }],
    }),
    now,
    undefined,
    { since: '2024-11-17', lots: {} },
  );
  expect(quiet).toMatchObject({
    status: 'matched',
    rodents: { inspections: 0, ratActivity: 0 },
    evictions: 0,
    housingCourt: { cases: 0, harassment: 0, kinds: [] },
    hpdRegistration: { current: false, through: '2025-09-01' },
  });
  expect((await retrieveBuildingRecords(address, source({ hpdRegistration: [] }), now)).hpdRegistration).toEqual({
    current: false,
    through: null,
  });

  // An answer that cannot be trusted is unknown, never none, and the rest of the report stands.
  const broken = await retrieveBuildingRecords(
    address,
    source({
      rodents: [{ status: 'Passed', count: 'many' }],
      court: { error: true },
      hpdRegistration: [{ buildingid: '999', registrationenddate: '2027-09-01T00:00:00.000' }],
      owner: [{ bbl: bbl + '.00000000', ownername: 'EXAMPLE PROPERTY LLC', version: '26v2' }],
    }),
    now,
  );
  expect(broken).toMatchObject({
    status: 'partial',
    rodents: null,
    evictions: null,
    housingCourt: null,
    hpdRegistration: null,
    openViolations: 2,
  });
  expect(broken.taxLotOwner?.units).toBeNull();
  expect(broken.errors.toSorted()).toEqual([
    'City rat inspections could not be retrieved; unknown, not none.',
    'HPD registration could not be checked.',
    'Housing Court cases could not be retrieved; unknown, not none.',
  ]);
  expect(
    (await retrieveBuildingRecords(address, source({ hpdRegistration: [{ buildingid: '12345', registrationenddate: 'soon' }] }), now))
      .hpdRegistration,
  ).toBeNull();
  // Without a tax lot, what is read by tax lot is not asked for.
  const noLot = await retrieveBuildingRecords(address, source({ buildings: [{ ...building, block: '0' }] }), now, undefined, evicted);
  expect(noLot).toMatchObject({ rodents: null, evictions: null, housingCourt: { cases: 3 } });
});

test('the kept facts and the grade take in rats, evictions, court cases and a lapsed registration', async () => {
  const { summarizeReport } = await import('../server/building-facts.ts');
  const { buildingGrade } = await import('../src/insights.ts');
  const facts = summarizeReport(await retrieveBuildingRecords(address, source(), now, undefined, evicted))!;
  expect(facts).toMatchObject({ rats: true, evictions: 3, courtCases: 3, harassment: true, unregistered: false, units: 20 });
  // 2 violations (1), 2 complaints (0), bedbugs (1), rats (1), harassment (2), 3 evictions in 20 apartments (1): D.
  expect(buildingGrade(facts)).toBe('D');
  const clean = { stabilized: null, openViolations: 0, complaints: 0, bedbugs: false, flood: false, checkedAt: now.toISOString() };
  expect(buildingGrade(clean)).toBe('A');
  expect(buildingGrade({ ...clean, rats: true })).toBe('B');
  expect(buildingGrade({ ...clean, courtCases: 3 })).toBe('B');
  expect(buildingGrade({ ...clean, courtCases: 2 })).toBe('A');
  expect(buildingGrade({ ...clean, harassment: true, courtCases: 1 })).toBe('B');
  // Evictions against the building's size where it is known: 3 in 200 apartments is not many, 5 in an unknown number is.
  expect(buildingGrade({ ...clean, evictions: 3, units: 200 })).toBe('A');
  expect(buildingGrade({ ...clean, evictions: 3, units: 20 })).toBe('B');
  expect(buildingGrade({ ...clean, evictions: 5 })).toBe('B');
  expect(buildingGrade({ ...clean, evictions: 4 })).toBe('A');
  expect(buildingGrade({ ...clean, unregistered: true, rats: true, harassment: true })).toBe('C');
  // A lapsed registration counts only where the building is known to have three or more apartments.
  const lapsed = { hpdRegistration: [{ buildingid: '12345', registrationenddate: '2025-09-01T00:00:00.000' }] };
  expect(summarizeReport(await retrieveBuildingRecords(address, source(lapsed), now))?.unregistered).toBe(true);
  const small = { ...lapsed, owner: [{ bbl: bbl + '.00000000', ownername: 'EXAMPLE PROPERTY LLC', version: '26v2', unitsres: '2' }] };
  expect(summarizeReport(await retrieveBuildingRecords(address, source(small), now))?.unregistered).toBeNull();
  const unknown = { rodents: { error: 1 }, court: { error: 1 }, hpdRegistration: { error: 1 } };
  expect(summarizeReport(await retrieveBuildingRecords(address, source(unknown), now))).toMatchObject({
    rats: null,
    evictions: null,
    courtCases: null,
    harassment: null,
    unregistered: null,
  });
});

test('a request the city refuses while busy is asked once more, and a second refusal is unknown', async () => {
  const fetcher = source();
  const asked = new Map<string, number>();
  /** Refuses each dataset's first `refusals` requests, as a busy service does. */
  const busy = (refusals: number) => async (url: string, options?: RequestInit) => {
    const dataset = new URL(url).pathname;
    asked.set(dataset, (asked.get(dataset) ?? 0) + 1);
    return asked.get(dataset)! <= refusals ? new Response('Service unavailable', { status: 503 }) : fetcher(url, options);
  };
  const report = await retrieveBuildingRecords(address, busy(1), now);
  expect(report.status).toBe('matched');
  expect(report.rodents).toEqual({ inspections: 7, ratActivity: 3 });
  expect([...asked.values()].every((count) => count === 2)).toBe(true);
  asked.clear();
  expect((await retrieveBuildingRecords(address, busy(2), now)).status, 'refused twice: the building is not identified').toBe(
    'unavailable',
  );
});

test('the block, vacate orders and an average apartment size come from the tax lot and the building', async () => {
  const report = await retrieveBuildingRecords(address, source(), now);
  expect(report.status).toBe('matched');
  // Crime split into violent and property; stores large enough to be groceries; parks, the largest first.
  expect(report.block).toEqual({
    point: { latitude: 40.7, longitude: -73.99 },
    crime: { violent: 3, property: 6, other: 4 },
    parks: [
      { name: 'Big Park', acres: 85 },
      { name: 'Pocket Park', acres: 0.4 },
    ],
    groceries: ['KEY FOOD', 'TRADER JOES'],
  });
  expect(report.vacateOrders).toEqual({ orders: 0, active: 0, latest: null });

  // An order with no date of rescission is in force, and the building is graded D whatever else it shows.
  const { summarizeReport } = await import('../server/building-facts.ts');
  const { buildingGrade } = await import('../src/insights.ts');
  const vacated = await retrieveBuildingRecords(
    address,
    source({
      vacate: [
        { vacate_type: 'Partial', primary_vacate_reason: 'Fire Damage', vacate_effective_date: '2026-03-20T00:00:00.000' },
        {
          vacate_type: 'Entire Building',
          primary_vacate_reason: 'Illegal Occupancy',
          vacate_effective_date: '2020-01-05T00:00:00.000',
          actual_rescind_date: '2021-02-01T00:00:00.000',
        },
      ],
    }),
    now,
  );
  expect(vacated.vacateOrders).toEqual({ orders: 2, active: 1, latest: { since: '2026-03-20', kind: 'Partial', reason: 'Fire Damage' } });
  const facts = summarizeReport(vacated)!;
  expect(facts).toMatchObject({ vacate: true, averageSquareFeet: 750 });
  expect(buildingGrade(facts)).toBe('D');
  expect(
    buildingGrade({ stabilized: null, openViolations: 0, complaints: 0, bedbugs: false, flood: false, vacate: true, checkedAt: '' }),
  ).toBe('D');
  // Orders all rescinded: none in force, the latest still named.
  const past = await retrieveBuildingRecords(
    address,
    source({
      vacate: [
        {
          vacate_type: 'Partial',
          primary_vacate_reason: 'Fire Damage',
          vacate_effective_date: '2020-01-05T00:00:00.000',
          actual_rescind_date: '2021-02-01T00:00:00.000',
        },
      ],
    }),
    now,
  );
  expect(past.vacateOrders).toMatchObject({ orders: 1, active: 0, latest: { since: '2020-01-05' } });

  // What cannot be trusted is unknown, each on its own.
  const broken = await retrieveBuildingRecords(
    address,
    source({ vacate: [{ vacate_effective_date: 'soon' }], crime: { error: 1 }, parks: { error: 1 }, stores: { error: 1 } }),
    now,
  );
  expect(broken).toMatchObject({ status: 'partial', vacateOrders: null, block: { crime: null, parks: null, groceries: null } });
  expect(summarizeReport(broken)).toMatchObject({ vacate: null });
  expect(broken.errors.toSorted()).toEqual([
    'Food stores nearby could not be retrieved.',
    'Parks nearby could not be retrieved.',
    'Reported crime nearby could not be retrieved.',
    'Vacate orders could not be retrieved; unknown, not none.',
  ]);
  // A lot with no location, or outside the city, has no block; one with no floor area has no average size.
  const nowhere = {
    bbl: bbl + '.00000000',
    ownername: 'EXAMPLE PROPERTY LLC',
    version: '26v2',
    unitsres: '20',
    latitude: '10',
    longitude: '10',
  };
  const unplaced = await retrieveBuildingRecords(address, source({ owner: [nowhere], bedbugs: [] }), now);
  expect(unplaced.block).toBeNull();
  expect(unplaced.taxLotOwner).toMatchObject({ averageSquareFeet: null, point: null });
});
