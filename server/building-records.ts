import type { FetchTransport } from '../src/fetch-type.ts';
import { buildingReport } from '../src/building-report.ts';
const HOST = 'https://data.cityofnewyork.us/resource/';
const LIMIT = 1000;
const normalize = (value: string) => value.trim().toUpperCase().replace(/\s+/g, ' ');
const id = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value);
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export function exactBuildingAddress(input: any) {
  if (!input || !buildingReport(input).nyc || typeof input.address !== 'string' || input.address.length > 180 || typeof input.zip !== 'string' || !/^\d{5}$/.test(input.zip)) return null;
  // Do not guess aliases, ranges, apartment suffixes, street suffixes or nearby buildings.
  const match = normalize(input.address).match(/^([1-9]\d*(?:-\d+)?[A-Z]?) ([A-Z0-9][A-Z0-9 .'-]{1,140})$/);
  if (!match || /\b(APT|APARTMENT|UNIT|SUITE)\b/.test(match[2])) return null;
  const zipBorough = /^(100|101|102)/.test(input.zip) ? '1' : /^104/.test(input.zip) ? '2' : /^112/.test(input.zip) ? '3' : /^(111|113|114|116)/.test(input.zip) || /^1100[45]$/.test(input.zip) ? '4' : /^103/.test(input.zip) ? '5' : null;
  const countyBorough = ({ 'NEW YORK': '1', BRONX: '2', KINGS: '3', QUEENS: '4', RICHMOND: '5' })[normalize(typeof input.county === 'string' ? input.county : '').replace(/ COUNTY$/, '')];
  const cityBorough = ({ MANHATTAN: '1', BRONX: '2', 'THE BRONX': '2', BROOKLYN: '3', QUEENS: '4', 'STATEN ISLAND': '5' })[normalize(typeof input.city === 'string' ? input.city : '')];
  const expected = [zipBorough, countyBorough, cityBorough].filter(Boolean);
  if (!expected.length || new Set(expected).size !== 1) return null;
  return { house: match[1], street: match[2], zip: input.zip, borough: expected[0] }; 
}
async function readOfficialJson(url: string, fetcher: FetchTransport, signal: AbortSignal) {
  const response = await fetcher(url, { signal, redirect: 'error', headers: { Accept: 'application/json' } });
  if (!response.ok || (Number(response.headers.get('content-length')) > 256 * 1024)) { await response.body?.cancel().catch(() => {}); throw new Error('Official source unavailable.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing official response.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > 256 * 1024) { await reader.cancel(); throw new Error('Official response too large.'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(data));
}
export async function readRows(dataset: string, query: Record<string, string>, fetcher: FetchTransport, signal: AbortSignal) {
  const rows = await readOfficialJson(HOST + dataset + '.json?' + new URLSearchParams(query), fetcher, signal);
  if (!Array.isArray(rows)) throw new Error('Invalid official response.');
  return rows;
}
export async function retrieveBuildingRecords(input: unknown, fetcher: FetchTransport = fetch, now = new Date(), parentSignal?: AbortSignal) {
  const checkedAt = now.toISOString();
  const unknown = { checkedAt, identity: null, openViolations: null, complaintsLast365Days: null, bedbugs: null, errors: [] as string[] };
  const address = exactBuildingAddress(input);
  if (!address) return { ...unknown, status: 'unmatched', errors: ['An exact NYC building street address and ZIP are required. No address inference was attempted.'] };
  const deadline = AbortSignal.timeout(25000);
  const signal = parentSignal ? AbortSignal.any([deadline, parentSignal]) : deadline;
  let rows: any[];
  try {
    rows = await readRows('kj4p-ruqc', {
      $select: 'buildingid,boroid,boro,housenumber,streetname,zip,bin,block,lot,recordstatus',
      $where: `housenumber=${quote(address.house)} AND upper(streetname)=${quote(address.street)} AND zip=${quote(address.zip)} AND upper(recordstatus)='ACTIVE'`, $limit: '2',
    }, fetcher, signal);
  } catch { return { ...unknown, status: 'unavailable', errors: ['Official HPD building identity could not be retrieved. No findings are inferred.'] }; }
  if (rows.length !== 1) return { ...unknown, status: rows.length ? 'ambiguous' : 'unmatched', errors: ['No unique active HPD building matched this exact address. Try official HPD Online; aliases and ranges are not guessed.'] };
  const row = rows[0];
  if (!row || !id(row.buildingid) || row.boroid !== address.borough || row.housenumber !== address.house || typeof row.streetname !== 'string' || normalize(row.streetname) !== address.street || row.zip !== address.zip || typeof row.recordstatus !== 'string' || normalize(row.recordstatus) !== 'ACTIVE') {
    return { ...unknown, status: 'unavailable', errors: ['Official identity response did not match the requested address.'] };
  }
  const identity = { buildingId: row.buildingid, address: `${row.housenumber} ${row.streetname}, ${row.zip}`, borough: String(row.boro ?? ''), bin: typeof row.bin === 'string' && new RegExp('^' + row.boroid + '\\d{6}$').test(row.bin) ? row.bin : null };
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const midnight = Date.parse(localDate + 'T00:00:00Z');
  const since = new Date(midnight - 364 * 86400000).toISOString().slice(0, 19);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  const until = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const errors: string[] = [];
  const [openViolations, complaintsLast365Days, bedbugs, dob] = await Promise.all([
    (async () => {
      try {
        const data = await readRows('wvxf-dwi5', { $select: 'count(*) as count', $where: `buildingid=${row.buildingid} AND upper(violationstatus)='OPEN'`, $limit: '1' }, fetcher, signal);
        if (data.length !== 1 || typeof data[0]?.count !== 'string' || !/^(0|[1-9]\d{0,8})$/.test(data[0].count)) throw new Error('Invalid count');
        return Number(data[0].count);
      } catch { errors.push('Open violation count unavailable; not zero.'); return null; }
    })(),
    (async () => {
      try {
        const data = await readRows('ygpa-z7cr', { $select: 'complaint_id', $group: 'complaint_id', $where: `building_id=${row.buildingid} AND received_date >= '${since}' AND received_date <= '${until}'`, $limit: String(LIMIT + 1), $order: 'complaint_id' }, fetcher, signal);
        if (data.length > LIMIT || data.some(item => !id(item?.complaint_id)) || new Set(data.map(item => item.complaint_id)).size !== data.length) throw new Error('Incomplete complaint count');
        return data.length;
      } catch { errors.push('Distinct complaint count unavailable or exceeds the 1,000-record safety cap; not zero.'); return null; }
    })(),
    (async () => {
      try {
        const data = await readRows('wz6d-d3jb', {
          $select: 'building_id,bin,latitude,longitude,of_dwelling_units,infested_dwelling_unit_count,eradicated_unit_count,re_infested_dwelling_unit,filing_date,filing_period_start_date,filling_period_end_date',
          $where: `building_id=${quote(row.buildingid)} AND filing_date <= '${until}' AND filling_period_end_date <= '${until}'`,
          $order: 'filling_period_end_date DESC,filing_date DESC', $limit: '2',
        }, fetcher, signal);
        const latest = data[0];
        const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
        const count = (value: unknown) => typeof value === 'string' && /^(0|[1-9]\d{0,5})$/.test(value);
        if (data.length < 1 || data.length > 2 || latest.building_id !== row.buildingid || (latest.bin && identity.bin && latest.bin !== identity.bin) ||
            !['filing_date', 'filing_period_start_date', 'filling_period_end_date'].every(key => date(latest[key])) ||
            latest.filing_period_start_date > latest.filling_period_end_date || latest.filing_date > until || latest.filling_period_end_date > until ||
            !['of_dwelling_units', 'infested_dwelling_unit_count', 'eradicated_unit_count', 're_infested_dwelling_unit'].every(key => count(latest[key])) ||
            ['infested_dwelling_unit_count', 'eradicated_unit_count', 're_infested_dwelling_unit'].some(key => Number(latest[key]) > Number(latest.of_dwelling_units)) ||
            (data[1] && data[1].filling_period_end_date === latest.filling_period_end_date && data[1].filing_date === latest.filing_date)) throw new Error('No unambiguous latest filing');
        const lat = Number(latest.latitude), lon = Number(latest.longitude);
        const point = typeof latest.latitude === 'string' && typeof latest.longitude === 'string' && Number.isFinite(lat) && Number.isFinite(lon) && lat >= 40.45 && lat <= 40.95 && lon >= -74.3 && lon <= -73.65 ? { latitude: lat, longitude: lon } : null;
        return { point, periodStart: latest.filing_period_start_date.slice(0, 10), periodEnd: latest.filling_period_end_date.slice(0, 10), filedAt: latest.filing_date,
          units: Number(latest.of_dwelling_units), infested: Number(latest.infested_dwelling_unit_count), eradicated: Number(latest.eradicated_unit_count), reinfested: Number(latest.re_infested_dwelling_unit) };
      } catch { errors.push('Latest owner-filed bedbug report unavailable or ambiguous; infestation status is unknown.'); return null; }
    })(),
    (async () => {
      if (!identity.bin) return null;
      return Promise.all([
        ['3h2n-5cm9', 'violation_category', 'Legacy BIS civil-penalty records'],
        ['855j-jady', 'violation_status', 'DOB NOW Safety civil-penalty records'],
        ['6bgk-3dad', 'ecb_violation_status', 'DOB ECB summons records'],
      ].map(async ([dataset, field, label]) => {
        try {
          const data = await readRows(dataset, { $select: `${field} as status,count(*) as count`, $where: `bin=${quote(identity.bin)}`, $group: field, $limit: '51' }, fetcher, signal);
          if (data.length > 50 || new Set(data.map(item => item?.status ?? null)).size !== data.length || data.some(item => (item.status != null && (typeof item.status !== 'string' || item.status.length > 200)) || typeof item.count !== 'string' || !/^(0|[1-9]\d{0,8})$/.test(item.count))) throw new Error('Invalid DOB count');
          return { dataset, label, groups: data.map(item => ({ status: item.status || 'Status unspecified', count: Number(item.count) })), error: null };
        } catch { errors.push(`${label} unavailable; unknown, not zero.`); return { dataset, label, groups: null, error: 'Official source unavailable or invalid.' }; }
      }));
    })(),
  ]);
  let flood = null;
  if (bedbugs?.point) {
    try {
      const point = bedbugs.point;
      const metadata = await readOfficialJson('https://a841-dotweb01.nyc.gov/arcgis/rest/services/Climate_Resiliency/Climate_Resiliency/MapServer/7?f=json', fetcher, signal);
      if (metadata.error || typeof metadata.name !== 'string' || !/2015.*PFIRM/i.test(metadata.name) || !/100.Year/i.test(metadata.name)) throw new Error('Flood layer edition changed or unavailable');
      const url = 'https://a841-dotweb01.nyc.gov/arcgis/rest/services/Climate_Resiliency/Climate_Resiliency/MapServer/7/query?' + new URLSearchParams({
        f: 'json', geometry: `${point.longitude},${point.latitude}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'FLD_ZONE,SFHA_TF', returnGeometry: 'false',
      });
      const data = await readOfficialJson(url, fetcher, signal);
      if (data.error || data.exceededTransferLimit || !Array.isArray(data.features) || data.features.length > 100 || data.features.some((item: { attributes?: { FLD_ZONE?: unknown; SFHA_TF?: unknown } }) => typeof item?.attributes?.FLD_ZONE !== 'string' || item.attributes.FLD_ZONE.length > 80 || (item.attributes.SFHA_TF !== 'T' && item.attributes.SFHA_TF !== 'F'))) throw new Error('Invalid flood layer response');
      flood = { point, layer: '2015 preliminary 100-year floodplain (PFIRM)', zones: [...new Set(data.features.map((item: { attributes: { FLD_ZONE: string } }) => item.attributes.FLD_ZONE))], intersects: data.features.some((item: { attributes: { SFHA_TF: string } }) => item.attributes.SFHA_TF === 'T') };
    } catch { errors.push('Preliminary flood-map point intersection unavailable; flood risk is unknown.'); }
  }
  return { checkedAt, status: errors.length ? 'partial' : 'matched', identity, openViolations, complaintsLast365Days, bedbugs, dob, flood, since: since.slice(0, 10), errors };
}
