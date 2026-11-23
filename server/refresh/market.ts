/**
 * FirstMover's StreetEasy rent data: the current month's listings, saved gzipped, and earlier months'
 * rent history for the charts.
 */
import { bundledRentAreas, marketSnapshot } from '../../src/bundled-market.ts';
import type { ListingData } from '../../src/domain.ts';
import { type MarketRow, SNAPSHOT_MONTH, decodeMarketRows, packRentMonth } from '../../src/market.ts';
import { type PackedRentRow, type RentHistory, priorRentMonths } from '../../src/rent-history.ts';
import type { Bucket, BucketHead, BucketObject, SourceFetch } from '../contracts.ts';
import { checkFirstMover, checkPublishedFirstMover } from '../sources/firstmover.ts';
import type { RefreshState } from './status.ts';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';

export const MARKET_KEY = 'rentals/firstmover.json.gz';
const MARKET_SCHEMA = 'companies-1';
const HISTORY_PREFIX = 'rentals/market-history/';

let cachedMarket: { bucket: Bucket; etag: string; market: { month: string; listings: ListingData[] } } | undefined;

const compressed = (value: unknown) => gzipSync(strToU8(JSON.stringify(value)));
/** A gzipped JSON snapshot this Worker wrote, read back with the type it was written with. */
const unpack = async <T>(object: BucketObject) => JSON.parse(strFromU8(gunzipSync(new Uint8Array(await object.arrayBuffer())))) as T;

export async function storedMarket(bucket: Bucket | undefined) {
  const head = await bucket?.head(MARKET_KEY);
  if (!head) return { month: SNAPSHOT_MONTH, listings: marketSnapshot() };
  if (cachedMarket && cachedMarket.bucket === bucket && cachedMarket.etag === head.etag) return cachedMarket.market;

  const object = await bucket!.get(MARKET_KEY);
  if (!object) return { month: SNAPSHOT_MONTH, listings: marketSnapshot() };
  const market = { month: object.customMetadata.month, listings: decodeMarketRows(await unpack<MarketRow[]>(object)) };
  cachedMarket = { bucket: bucket!, etag: object.etag, market };
  return market;
}

export async function storedRentHistory(
  bucket: Bucket | undefined,
  latest: string,
  region: string,
  grouping: string,
): Promise<RentHistory> {
  return Promise.all(
    priorRentMonths(latest).map(async (month) => {
      const object = month >= SNAPSHOT_MONTH ? await bucket?.get(HISTORY_PREFIX + month + '.json.gz') : null;
      const areas = object
        ? (await unpack<Record<string, Record<string, PackedRentRow[]> | undefined>>(object))[region]?.[grouping]
        : bundledRentAreas(month, region, grouping);
      return [month, areas ?? []] as const;
    }),
  );
}

export function marketBaseline(
  object: BucketHead | null | undefined,
  previous: RefreshState['market'],
): { month: string; revision: string; updatedAt: string; catalogEtag?: string; csvEtag?: string } | null {
  const metadata = object?.customMetadata;
  if (metadata?.schema !== MARKET_SCHEMA) return null;
  const sameRelease = previous?.revision === metadata.revision;
  return {
    ...metadata,
    month: metadata.month,
    revision: metadata.revision,
    updatedAt: metadata.updatedAt,
    catalogEtag: sameRelease ? previous?.catalogEtag : '',
    csvEtag: sameRelease ? previous?.csvEtag : '',
  };
}

export async function refreshMarket(
  bucket: Bucket,
  previous: RefreshState['market'],
  checkedAt: string,
  fetcher: SourceFetch,
  imported: Awaited<ReturnType<typeof checkFirstMover>> | undefined,
  isImport: boolean,
  onDemand: boolean,
) {
  const stored = await bucket.head(MARKET_KEY);
  const baseline = marketBaseline(stored, previous);
  const check = onDemand ? checkPublishedFirstMover : checkFirstMover;
  const result = isImport ? imported : await check(baseline, fetcher);
  const month = result?.month,
    revision = result?.revision;
  if (
    !result ||
    typeof month !== 'string' ||
    !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ||
    typeof revision !== 'string' ||
    !/^[a-f0-9]{40}$/.test(revision) ||
    (baseline && month < baseline.month)
  )
    throw new Error('The FirstMover import failed.');
  if (!result.changed && revision !== baseline?.revision) throw new Error('The FirstMover release has changed.');
  if (
    result.changed &&
    (!Array.isArray(result.rows) ||
      result.rows.length === 0 ||
      result.rows.length > 60000 ||
      result.rows.some(
        (row: unknown) =>
          !Array.isArray(row) || row.length !== 15 || typeof row[12] !== 'string' || !/^\/(rental|building)\//.test(row[12]),
      ))
  ) {
    throw new Error('The FirstMover import had invalid listings.');
  }
  const updatedAt = result.changed ? checkedAt : baseline!.updatedAt;
  if (result.changed) {
    if (stored && stored.customMetadata.month >= SNAPSHOT_MONTH && stored.customMetadata.month < month) {
      const previousMarket = await storedMarket(bucket);
      await bucket.put(HISTORY_PREFIX + previousMarket.month + '.json.gz', compressed(packRentMonth(previousMarket.listings)));
    }
    await bucket.put(MARKET_KEY, compressed(result.rows), {
      customMetadata: { month: month, revision: revision, updatedAt, schema: MARKET_SCHEMA },
    });
  }
  return {
    status: result.changed ? 'updated' : 'current',
    month: month,
    revision: revision,
    catalogEtag: 'catalogEtag' in result ? result.catalogEtag : undefined,
    csvEtag: result.csvEtag,
    updatedAt,
  };
}
