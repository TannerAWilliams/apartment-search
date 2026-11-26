/**
 * The inventory file and its head (docs/architecture/search.md): every listing, merged and scored, written
 * after each sync and once an hour, and kept in Workers KV, which serves the same value from every Cloudflare
 * location. Browsers download the file once per version and search it themselves, so a search does not wait for
 * a Worker instance to read and score the listings.
 *
 *   head            what the current file is (its version), and the answer to the app's opening search
 *   file:<version>  the file, gzipped; a version is the hash of its contents, so it never changes
 *   br:<version>    the same file in Brotli, about a sixth smaller, for the browsers that read it (nearly all)
 */
import { type Inventory, answerSearch } from '../src/answer.ts';
import type { SearchResult } from '../src/domain.ts';
import { openingSearchBody } from '../src/early-requests.ts';
import { encodeInventory, INVENTORY_FORMAT } from '../src/inventory-format.ts';
import { localWorkplace, parseFilters } from '../src/search.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { log } from './log.ts';
import { offline, search, stationsForEstimates } from './search.ts';

/** The part of a Workers KV namespace the inventory uses. */
export type InventoryStore = {
  get(key: string, options: { type: 'text'; cacheTtl?: number }): Promise<string | null>;
  get(key: string, options: { type: 'arrayBuffer'; cacheTtl?: number }): Promise<ArrayBuffer | null>;
  put(key: string, value: string | ArrayBuffer, options?: { expirationTtl?: number }): Promise<void>;
};
export type InventoryHead = {
  format: number;
  version: string;
  builtAt: string;
  /** The deployed code that built it; a newer deploy builds again, in case scoring changed. */
  build: string;
  listings: number;
  bytes: number;
  /** How the file is stored. A head from before Brotli names none, and its file is written again in both. */
  encodings?: Encoding[];
  /** The answer to the app's opening search, so a first visit shows apartments before the file has arrived. */
  opening: SearchResult;
};

/** How a stored file is compressed, by its Content-Encoding name. */
export type Encoding = 'br' | 'gzip';
const ENCODINGS: Encoding[] = ['br', 'gzip'];
const HEAD_KEY = 'head';
const fileKey = (version: string, encoding: Encoding) => (encoding === 'br' ? 'br:' : 'file:') + version;
/** A replaced file is kept this long for browsers still reading it, then KV removes it. */
const FILE_KEPT_SECONDS = 7 * 86_400;
/** Fields a search and a card do not use; an apartment's own page reads them from the server. */
const NOT_IN_FILE = ['priceHistory', 'county', 'seenAt'];

/**
 * The text compressed as a stream, which needs little memory however large the file. The runtime's Brotli has no
 * quality setting; its own is about a sixth smaller than gzip here (docs/architecture/README.md has the measure).
 */
const compressed = async (text: string, encoding: Encoding) =>
  new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream((encoding === 'br' ? 'brotli' : 'gzip') as CompressionFormat)),
  ).arrayBuffer();
const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/** Every listing as the web app searches them, with the stations its estimates need. */
export async function readInventory(env: AppEnv & { BUCKET: Bucket }): Promise<Inventory> {
  const filters = parseFilters(JSON.parse(openingSearchBody()));
  const [scored, stations] = await Promise.all([search(filters, env, offline, true, { scored: true }), stationsForEstimates(env.BUCKET)]);
  return { ...scored, stations };
}

/** The file's text and the head that describes it. */
export async function composeInventory(inventory: Inventory, build: string, now = new Date()) {
  const { listings, ...rest } = inventory;
  const rows = listings.map((listing) => Object.fromEntries(Object.entries(listing).filter(([name]) => !NOT_IN_FILE.includes(name))));
  const text = encodeInventory(rest, rows);
  const filters = parseFilters(JSON.parse(openingSearchBody()));
  const head: InventoryHead = {
    format: INVENTORY_FORMAT,
    version: (await sha256(text)).slice(0, 24),
    builtAt: now.toISOString(),
    build,
    listings: rows.length,
    bytes: text.length,
    encodings: ENCODINGS,
    // Answered from the rows as the browser will have them.
    opening: answerSearch({ ...inventory, listings: rows as unknown as Inventory['listings'] }, filters, localWorkplace(filters)!),
  };
  return { text, head };
}

export const readHead = async (store: InventoryStore): Promise<InventoryHead | null> => {
  const text = await store.get(HEAD_KEY, { type: 'text', cacheTtl: 30 });
  const head = text ? (JSON.parse(text) as InventoryHead) : null;
  return head?.format === INVENTORY_FORMAT ? head : null;
};
/** A version's file in one encoding. A version never changes, so locations keep it a day. */
export const readFile = (store: InventoryStore, version: string, encoding: Encoding) =>
  store.get(fileKey(version, encoding), { type: 'arrayBuffer', cacheTtl: 86_400 });

/**
 * Builds the inventory and stores it when it differs from the one stored. Says what it did. Called after each
 * sync and each hour (listings age out of "recently checked" with time alone), and when a deploy finds the
 * stored one built by older code.
 */
export async function refreshInventory(env: AppEnv & { BUCKET: Bucket }, now = new Date()) {
  const store = env.INVENTORY;
  if (!store) return 'no-store';
  const build = env.CF_VERSION_METADATA?.id ?? '';
  const [{ text, head }, current] = await Promise.all([composeInventory(await readInventory(env), build, now), readHead(store)]);
  if (current?.version === head.version && current.build === build) return 'unchanged';
  // The file first, in each encoding, so the head never names a file that is not there.
  if (current?.version !== head.version || !ENCODINGS.every((encoding) => current.encodings?.includes(encoding)))
    await Promise.all(
      ENCODINGS.map(async (encoding) =>
        store.put(fileKey(head.version, encoding), await compressed(text, encoding), { expirationTtl: FILE_KEPT_SECONDS }),
      ),
    );
  await store.put(HEAD_KEY, JSON.stringify(head));
  log.info('inventory_built', { version: head.version, listings: head.listings, bytes: head.bytes });
  return 'built';
}

/** One build at a time per Worker instance, for requests that find the stored inventory missing or old. */
let building: Promise<unknown> | null = null;
export function refreshInventorySoon(env: AppEnv & { BUCKET: Bucket }) {
  building ??= refreshInventory(env)
    .catch((cause) => log.error('inventory_build_failed', cause))
    .finally(() => {
      building = null;
    });
  return building;
}
