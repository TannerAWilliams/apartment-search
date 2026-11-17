import type { SourceFetch } from './refresh.ts';
import { buildingKey } from '../src/listings.ts';

const NYC_OPEN_DATA = 'https://data.cityofnewyork.us';
const LOTTERY_DATASET = 'vy5i-a666';
const BUILDING_DATASET = 'nibs-na6y';
const BOROUGHS: Record<string, string> = { BK: 'Brooklyn', BX: 'Bronx', MN: 'Manhattan', QN: 'Queens', SI: 'Staten Island' };
const DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const SIZE_FIELDS = ['studio', '1bed', '2bed', '3bed', '4bed'];

export const housingDate = (now: Date) => DATE.format(now);

async function readJson(path: string, fetcher: SourceFetch) {
  const response = await fetcher(NYC_OPEN_DATA + path, {
    redirect: 'error', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('NYC Open Data returned HTTP ' + response.status + '.');
  return response.json();
}

function query(id: string, params: Record<string, string>, fetcher: SourceFetch) {
  return readJson('/resource/' + id + '.json?' + new URLSearchParams(params), fetcher);
}

export async function loadHousingConnect(fetcher: SourceFetch, now: Date) {
  const today = housingDate(now);
  const date = `'${today}T00:00:00'`;
  const [meta, rows] = await Promise.all([
    readJson('/api/views/' + LOTTERY_DATASET, fetcher),
    query(LOTTERY_DATASET, {
      $where: `development_type = 'Rental' and lottery_status = 'Active' and lottery_start_date <= ${date} and lottery_end_date >= ${date}`,
      $order: 'lottery_end_date ASC, lottery_id ASC',
      $limit: '250',
    }, fetcher),
  ]);
  if (!Array.isArray(rows)) throw new Error('The Housing Connect data was invalid.');
  const active = rows.filter((row) => row && /^\d{1,12}$/.test(row.lottery_id) &&
    row.lottery_status === 'Active' && row.development_type === 'Rental' && row.lottery_start_date?.slice(0, 10) <= today &&
    row.lottery_end_date?.slice(0, 10) >= today);
  const ids = [...new Set(active.map((row) => row.lottery_id))];
  const buildings = ids.length ? await query(BUILDING_DATASET, {
    $select: 'lottery_id,house_number,street_name,borough,address_zipcode',
    $where: `lottery_id in (${ids.join(',')})`,
    $limit: '1000',
  }, fetcher) : [];
  if (!Array.isArray(buildings)) throw new Error('The Housing Connect building data was invalid.');

  const byId = new Map<string, { addresses: Set<string>; keys: Set<string> }>();
  for (const row of buildings) {
    if (!row.house_number || !row.street_name) continue;
    const address = `${row.house_number} ${row.street_name}`;
    const place = [BOROUGHS[row.borough], row.address_zipcode].filter(Boolean).join(' ');
    if (!byId.has(row.lottery_id)) byId.set(row.lottery_id, { addresses: new Set<string>(), keys: new Set<string>() });
    const building = byId.get(row.lottery_id)!;
    building.addresses.add([address, place].filter(Boolean).join(', '));
    if (/^\d{5}$/.test(row.address_zipcode)) {
      const key = buildingKey({ address, zip: row.address_zipcode, state: 'NY' });
      if (key) building.keys.add(key);
    }
  }

  return {
    publishedAt: Number.isFinite(meta?.rowsUpdatedAt) ? new Date(meta.rowsUpdatedAt * 1000).toISOString() : null,
    opportunities: active.map((row) => ({
      id: row.lottery_id,
      name: String(row.lottery_name || 'Housing Connect lottery').slice(0, 180),
      borough: BOROUGHS[row.borough] ?? '',
      closes: row.lottery_end_date.slice(0, 10),
      sizes: SIZE_FIELDS.map((size) => Number(row['unit_distribution_' + size]) || 0),
      addresses: [...(byId.get(row.lottery_id)?.addresses ?? [])].sort(),
      buildingKeys: [...(byId.get(row.lottery_id)?.keys ?? [])],
      url: 'https://housingconnect.nyc.gov/PublicWeb/details/' + row.lottery_id,
    })),
  };
}
