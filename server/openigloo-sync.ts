import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { FetchTransport } from '../src/fetch-type.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { crawlOpenigloo, finishOpenigloo, OPENIGLOO, OPENIGLOO_CELLS, openiglooSearch, type OpeniglooRow } from './openigloo.ts';
import { refreshSources } from './refresh.ts';

/**
 * The complete Openigloo sync takes about 45 minutes at one request a second, so the Workflow
 * runs it in steps: one per borough and bedroom count, each saving its rows, then a final step
 * that combines them and saves the inventory through the normal import checks.
 */
export const OPENIGLOO_CELL_COUNT = OPENIGLOO_CELLS.length;
const partKey = (index: number) => `rentals/openigloo-parts/${index}.json.gz`;
type Part = { run: string; index: number; total: number; calls: number; unresolved: number; rows: OpeniglooRow[] };

export async function crawlOpeniglooCell(bucket: Bucket, run: string, index: number, fetcher: FetchTransport,
  wait?: (ms: number) => Promise<unknown>) {
  const cell = OPENIGLOO_CELLS[index];
  if (!cell) throw new Error('Unknown Openigloo search cell.');
  const crawl = await crawlOpenigloo(await openiglooSearch(fetcher, wait), [cell]);
  const part: Part = { run, index, ...crawl };
  await bucket.put(partKey(index), gzipSync(strToU8(JSON.stringify(part))));
  return { cell: `${cell.borough} ${cell.bedrooms === 4 ? '4+' : cell.bedrooms} BR`, total: crawl.total, rows: crawl.rows.length,
    calls: crawl.calls, unresolved: crawl.unresolved };
}

export async function finishOpeniglooRun(env: AppEnv & { BUCKET: Bucket }, run: string, fetcher: FetchTransport, now = new Date()) {
  const parts: Part[] = await Promise.all(OPENIGLOO_CELLS.map(async (_, index) => {
    const object = await env.BUCKET.get(partKey(index));
    const part = object ? JSON.parse(strFromU8(gunzipSync(new Uint8Array(await object.arrayBuffer())))) as Part : null;
    if (part?.run !== run || part.index !== index) throw new Error('An Openigloo search step from this sync is missing; the saved inventory was kept.');
    return part;
  }));
  const rows = new Map<string, OpeniglooRow>();
  for (const part of parts) for (const row of part.rows) if (row.id && !rows.has(row.id)) rows.set(row.id, row);
  const sum = (key: 'total' | 'calls' | 'unresolved') => parts.reduce((total, part) => total + part[key], 0);
  const result = await finishOpenigloo({ rows: [...rows.values()], total: sum('total'), calls: sum('calls'), unresolved: sum('unresolved') }, fetcher, now);
  const outcome = await refreshSources(env, { imports: { [OPENIGLOO.id]: result }, sourceId: OPENIGLOO.id, now, fetcher });
  return { state: outcome.state, total: result.total, listingCount: result.listings.length, calls: result.pages,
    status: outcome.sources?.find(({ id }) => id === OPENIGLOO.id) };
}
