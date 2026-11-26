/**
 * Searching in the app itself (docs/architecture/search.md). The server publishes every listing, already merged
 * and scored, as one compact file; the app downloads it once per version and answers searches from it with the
 * same code the server uses (src/answer.ts). A filter, a sort, a page or the map then costs no request at all.
 *
 * The server still answers a search when the file cannot: before it has arrived (except the opening search,
 * whose answer comes with the file's head), where there is none, and for searches the file does not cover
 * (the phone app's official-only search, saved inventory, routed commute limits).
 */
import { type Inventory, answerSearch, withTransitEstimates } from './answer.ts';
import type { SearchFilters, SearchResult, Workplace } from './domain.ts';
import { openingSearchBody } from './early-requests.ts';
import type { FetchTransport } from './fetch-type.ts';
import { decodeInventory, INVENTORY_FORMAT } from './inventory-format.ts';
import { localWorkplace, needsCommute, parseFilters } from './search.ts';

type Head = { format: number; version: string; opening: SearchResult };
type Options = { token?: string; signal?: AbortSignal };
type Api = {
  (path: 'search', options?: Options & { body?: object }): Promise<SearchResult>;
  <T = unknown>(path: string, options?: Options & { body?: object }): Promise<T>;
};
/** How often a long-open page asks whether there is a newer file. */
const HEAD_CHECK_MS = 5 * 60_000;

/** Whether the file answers this search: the web app's own inventory, with no routed commute limit. */
const coveredByFile = (filters: SearchFilters) =>
  filters.liveOnly && filters.includeCached && !filters.officialOnly && !needsCommute(filters);

export function createInventorySearch({
  api,
  origin,
  fetcher,
  enabled,
  pause,
  now = Date.now,
}: {
  api: Api;
  origin: string;
  fetcher: FetchTransport;
  /** Off where the app searches through the server only (the phone app). */
  enabled: boolean;
  /** Lets the page respond between pieces of decoding. */
  pause?: () => Promise<void>;
  now?: () => number;
}) {
  let head: Promise<Head | null> | null = null;
  let headAt = 0;
  let file: { version: string; loading: Promise<Inventory | null>; loaded: Inventory | null } | null = null;
  const opening = JSON.stringify(parseFilters(JSON.parse(openingSearchBody())));

  const askHead = () =>
    api<Head>('inventory')
      .then((answer) => (answer.format === INVENTORY_FORMAT ? answer : null))
      .catch(() => null);
  function currentHead() {
    const known = head;
    if (known && now() - headAt <= HEAD_CHECK_MS) return known;
    headAt = now();
    const asked = askHead();
    // The first time, wait for it. Later, keep answering from the file in hand and take a newer one when it is known.
    if (!known) head = asked;
    else
      void Promise.all([known, asked]).then(([older, newer]) => {
        if (newer && newer.version !== older?.version) head = asked;
      });
    return known ?? asked;
  }
  function inventoryOf({ version }: Head) {
    if (file?.version === version) return file;
    const mine: NonNullable<typeof file> = {
      version,
      loaded: null,
      loading: Promise.resolve(fetcher(`${origin}/api/inventory/${version}`))
        .then((response) => (response.ok ? response.text() : Promise.reject(new Error('The inventory file could not be read.'))))
        .then((text) => decodeInventory<Omit<Inventory, 'listings'>, Record<string, unknown>>(text, pause))
        .then(({ header, rows }): Inventory | null => {
          // Rows are listings as the server wrote them (server/inventory.ts).
          mine.loaded = { ...header, listings: rows as unknown as Inventory['listings'] };
          return mine.loaded;
        })
        // The server answers while there is no file; the next head check tries again.
        .catch(() => {
          if (file === mine) file = null;
          return null;
        }),
    };
    file = mine;
    return mine;
  }

  /** The search's answer: from the file when it can be, otherwise from the server. */
  async function search(body: object, options: Options = {}): Promise<SearchResult> {
    const fromServer = () => api('search', { body, ...options });
    if (!enabled) return fromServer();
    const filters = parseFilters(body);
    if (!coveredByFile(filters)) return fromServer();
    const known = await currentHead();
    if (!known) return fromServer();
    const mine = inventoryOf(known);
    // The opening search's answer came with the head: shown at once, while the file arrives.
    if (!mine.loaded && JSON.stringify({ ...filters, includeCommute: true }) === opening) return known.opening;
    const inventory = mine.loaded ?? (await mine.loading);
    if (!inventory) return fromServer();
    const workplace =
      localWorkplace(filters) ?? (await api<Workplace>('geocode', { body: { address: filters.customWorkplace }, ...options }));
    return answerSearch(inventory, filters, workplace) as SearchResult;
  }

  /**
   * One listing from the file, with its estimated transit time to the destination, for its own page. Undefined
   * when the file cannot say (none here, or the listing is not in it): the server is asked then.
   */
  async function listing(id: string, place: Pick<SearchFilters, 'workplace' | 'customWorkplace'>, options: Options = {}) {
    if (!enabled) return undefined;
    const known = await currentHead();
    const mine = known && inventoryOf(known);
    const inventory = mine ? (mine.loaded ?? (await mine.loading)) : null;
    const found = inventory?.listings.find((candidate) => candidate.id === id);
    if (!inventory || !found) return undefined;
    const filters = parseFilters({ ...place, region: 'all' });
    // A destination that cannot be found leaves the listing as it is.
    const destination =
      localWorkplace(filters) ??
      (await api<Workplace>('geocode', { body: { address: filters.customWorkplace }, ...options }).catch(() => null));
    return destination ? withTransitEstimates([found], inventory.stations, destination)[0]! : found;
  }

  return {
    search,
    listing,
    /** Starts downloading the file, so the first search made does not wait for it. */
    preload: () => void (enabled && currentHead().then((known) => known && inventoryOf(known))),
  };
}
