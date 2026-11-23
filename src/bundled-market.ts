import base64 from 'base64-js';
import { gunzipSync, strFromU8 } from 'fflate';
import type { ListingData, SearchFilters } from './domain.ts';
import { SNAPSHOT_GZIP } from './data/snapshot.ts';
import { RENT_HISTORY_GZIP } from './data/rent-history.ts';
import { SNAPSHOT_MONTH } from './data/snapshot-month.ts';
import { decodeMarketRows, localSearch } from './market.ts';
import { priorRentMonths, type PackedRentRow, type RentHistory } from './rent-history.ts';
import { localWorkplace } from './search.ts';

/**
 * The FirstMover snapshot and rent history bundled with the code (about 770 KB). The Worker falls back
 * to them before its first refresh, and native builds use them offline. The web app never loads this
 * module: it always has the Worker (see offline-rent-data.web.ts).
 */
let snapshot: ListingData[] | undefined;
let history: Record<string, Record<string, Record<string, PackedRentRow[]>>> | undefined;

const unpack = (encoded: string) => JSON.parse(strFromU8(gunzipSync(base64.toByteArray(encoded))));

export function marketSnapshot() {
  snapshot ??= decodeMarketRows(unpack(SNAPSHOT_GZIP));
  return snapshot;
}

export function snapshotSearch(filters: SearchFilters, workplace = localWorkplace(filters), market = { month: SNAPSHOT_MONTH, listings: marketSnapshot() }) {
  const result = localSearch(market.listings, filters, workplace, 'snapshot', [
    { id: 'streeteasy', name: 'StreetEasy', status: 'snapshot' },
  ]);
  return { ...result, snapshotMonth: market.month };
}

export function bundledRentAreas(month: string, region: string, grouping: string) {
  history ??= unpack(RENT_HISTORY_GZIP);
  return history![month]?.[region]?.[grouping] ?? [];
}

export function bundledRentHistory(latest: string, region: string, grouping: string): RentHistory {
  return priorRentMonths(latest).map((month) => [month, bundledRentAreas(month, region, grouping)]);
}
