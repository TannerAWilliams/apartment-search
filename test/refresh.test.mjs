import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFirstMoverCsv } from '../server/firstmover.mjs';
import { housingDate } from '../server/housing.mjs';
import { refreshSources, refreshStatus, storedFeed, storedHousing, storedMarket } from '../server/refresh.mjs';
import { handleApi } from '../server/api.mjs';

const CSV = [
  'id,street,unit,state,zip_code,neighborhood,latitude,longitude,bedrooms,price,url,created_at_utc,building_type,ignored',
  'b,"28 Example Street",2,NY,11215,Park Slope,40.67,-73.99,1,2100,https://streeteasy.com/rental/222,2026-10-02,Rental,"with ""quotes"""',
  'a,"28 Example Street",2,NY,11215,Park Slope,40.67,-73.99,1,1900,https://streeteasy.com/rental/222,2026-10-01,Rental,"ignored"',
  'c,12 Grove Street,3,NJ,07302,Waterfront,40.71,-74.04,2,2400,https://streeteasy.com/rental/333,2026-10-03,Rental,"ignored"',
].join('\r\n');

class TestBucket {
  records = new Map();
  version = 0;

  async head(key) { return this.records.get(key)?.meta ?? null; }

  async get(key) {
    const record = this.records.get(key);
    if (!record) return null;
    const bytes = record.bytes;
    return {
      ...record.meta,
      text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  async put(key, value, options = {}) {
    const previous = this.records.get(key);
    if (options.onlyIf?.etagDoesNotMatch === '*' && previous) return null;
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== previous?.meta.etag) return null;
    const meta = { etag: String(++this.version), customMetadata: options.customMetadata ?? {} };
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.records.set(key, { bytes, meta });
    return meta;
  }
}

const at = new Date('2026-11-10T00:25:00Z');
const next = new Date('2026-11-10T01:00:00Z');
const active = {
  lottery_id: '7612', lottery_name: 'Example Rental Lottery', lottery_status: 'Active', development_type: 'Rental',
  lottery_start_date: '2026-10-15T00:00:00.000', lottery_end_date: '2026-11-09T00:00:00.000',
  borough: 'BK', unit_distribution_1bed: '7',
};
const feed = { id: 'zillow', url: 'https://feed.example.test/current' };
const listing = { id: 'one', address: '12 Grove Street', unit: '3', city: 'Jersey City', state: 'NJ',
  zipCode: '07302', county: 'Hudson', status: 'Active', bedrooms: 2, price: 2400 };

function sources({ failure = false, conditional = false } = {}) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (failure) return new Response(null, { status: 503 });
    if (path.endsWith('/contents/public/data')) {
      if (conditional) {
        assert.equal(options.headers['If-None-Match'], '"october"');
        return new Response(null, { status: 304 });
      }
      return Response.json([{ name: '2026-10.csv', sha: 'a'.repeat(40), type: 'file', size: CSV.length }],
        { headers: { ETag: '"october"' } });
    }
    if (path.endsWith('/2026-10.csv') && !conditional) return new Response(CSV);
    if (path === '/api/views/vy5i-a666') return Response.json({ rowsUpdatedAt: 1793635221 });
    if (path === '/resource/vy5i-a666.json') {
      assert.match(new URL(url).searchParams.get('$where'), /2026-11-09/);
      return Response.json([active, { ...active, lottery_id: '1', lottery_status: 'Tenant Selection' }]);
    }
    if (path === '/resource/nibs-na6y.json') return Response.json([
      { lottery_id: '7612', house_number: '28', street_name: 'Example St', borough: 'BK', address_zipcode: '11215' },
    ]);
    if (url === feed.url) return Response.json([listing]);
    assert.fail('Unexpected network request: ' + url);
  };
}

test('the FirstMover import handles CSV quotes, orders prices by first posting, and deduplicates original links', () => {
  const rows = parseFirstMoverCsv(CSV, '2026-10');
  assert.equal(rows.length, 2);
  assert.equal(rows[0][11], 1900);
  assert.equal(rows[1][3], 'Jersey City');
  assert.throws(() => parseFirstMoverCsv(CSV, '2026-09'), /different month/);
});

test('an hourly refresh persists each source, makes charts use the imported records, and skips the duplicate hour', async () => {
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  const first = await refreshSources(env, { fetcher: sources(), now: at });
  assert.equal(first.state, 'complete');
  assert.deepEqual(first.sources.map(({ id, status }) => [id, status]), [
    ['firstmover', 'updated'], ['housingconnect', 'updated'], ['zillow', 'updated'],
  ]);
  assert.equal((await storedFeed(env.BUCKET, feed)).listings[0].rent, 2400);
  assert.equal((await storedHousing(env.BUCKET, at)).opportunities[0].addresses[0], '28 Example St, Brooklyn 11215');

  const api = await handleApi(new Request('https://private.test/api/market?region=nyc'), env);
  const chart = await api.json();
  assert.equal(chart.month, '2026-10');
  assert.equal(chart.areas[0].sizes[1].median, 1900);

  const duplicate = await refreshSources(env, { fetcher: () => assert.fail('The hour was already checked'), now: at });
  assert.equal(duplicate.state, 'already_checked');
  const updated = await refreshSources(env, { fetcher: sources({ conditional: true }), now: next });
  assert.equal(updated.state, 'complete');
  assert.equal(updated.sources[0].status, 'current');
  assert.equal(updated.sources[1].status, 'current');
  assert.equal(updated.sources[0].updatedAt, at.toISOString());
  assert.equal(updated.lastCheckedAt, next.toISOString());
});

test('failed sources preserve the last data and expired lotteries are removed at the Eastern date boundary', async () => {
  const env = { BUCKET: new TestBucket() };
  await refreshSources(env, { fetcher: sources(), now: at });
  const failure = await refreshSources(env, { fetcher: sources({ failure: true }), now: next });
  assert.equal(failure.state, 'partial');
  assert.ok(failure.sources.every(({ status, updatedAt }) => status === 'failed' && updatedAt === at.toISOString()));
  assert.equal((await storedMarket(env.BUCKET)).listings[0].rent, 1900);
  assert.equal((await storedHousing(env.BUCKET, at)).opportunities.length, 1);
  assert.equal(housingDate(new Date('2026-11-10T05:00:00Z')), '2026-11-10');
  assert.equal((await storedHousing(env.BUCKET, new Date('2026-11-10T05:00:00Z'))).opportunities.length, 0);
  assert.deepEqual(await refreshStatus(env.BUCKET), { lastCheckedAt: next.toISOString(), sources: failure.sources });
});

test('only one overlapping refresh can claim the hourly write', async () => {
  const env = { BUCKET: new TestBucket() };
  let calls = 0;
  const fetcher = async (...args) => { calls++; return sources()(...args); };
  const results = await Promise.all([refreshSources(env, { fetcher, now: at }), refreshSources(env, { fetcher, now: at })]);
  assert.deepEqual(results.map(({ state }) => state).sort(), ['complete', 'running']);
  assert.equal(calls, 5);
});

test('the private writer imports a completed public check without publisher access', async () => {
  const { encodeSourceImport, pullPublicSources } = await import('../src/pull-sources.mjs');
  const inputs = await pullPublicSources({ market: null }, sources(), at);
  const env = { BUCKET: new TestBucket(), APP_ACCESS_TOKEN: 'test-owner' };
  const request = new Request('https://private.test/api/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-owner' },
    body: JSON.stringify(encodeSourceImport(inputs)),
  });
  const response = await handleApi(request, env, { requireToken: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'complete');
  assert.equal((await storedHousing(env.BUCKET, at)).opportunities.length, 1);
  assert.equal((await storedMarket(env.BUCKET)).listings.length, 2);
});
