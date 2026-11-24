import { CITYREALTY_COVERAGE, CITYREALTY_ID, CITYREALTY_TRANSPORT } from './cityrealty.ts';
import { OPENIGLOO, OPENIGLOO_COVERAGE, OPENIGLOO_TRANSPORT } from './openigloo.ts';
import { ZUMPER_COVERAGE, ZUMPER_LIVE, ZUMPER_TRANSPORT } from './zumper.ts';
import { BRODSKY_TRANSPORT } from './brodsky.ts';
import { GLENWOOD_TRANSPORT } from './glenwood.ts';
import { STUYTOWN_TRANSPORT } from './stuytown.ts';

/**
 * Sources that sync their whole inventory rather than a sample. Their syncs are too long for an
 * API request, so on Cloudflare they run in the sync Workflow, and their data counts as current
 * for a day. Add a source here, not as special cases in refresh or the API.
 */
type CompleteSync = {
  id: string;
  name: string;
  /** The transport a complete snapshot records; any other transport is a sample. */
  transport: string;
  coverage: string;
  /** Upper bound for one sync, which also bounds the refresh lock it holds. */
  timeoutMs: number;
  /** Timeout of the Workflow step that runs the sync (Openigloo runs in several steps). */
  stepTimeout: '6 minutes' | '13 minutes' | '25 minutes' | '30 minutes';
};

export const COMPLETE_SYNCS: readonly CompleteSync[] = [
  {
    id: CITYREALTY_ID,
    name: 'CityRealty',
    transport: CITYREALTY_TRANSPORT,
    coverage: CITYREALTY_COVERAGE,
    timeoutMs: 12 * 60_000,
    stepTimeout: '13 minutes',
  },
  {
    id: OPENIGLOO.id,
    name: OPENIGLOO.name,
    transport: OPENIGLOO_TRANSPORT,
    coverage: OPENIGLOO_COVERAGE,
    timeoutMs: 28 * 60_000,
    stepTimeout: '30 minutes',
  },
  {
    id: ZUMPER_LIVE.id,
    name: ZUMPER_LIVE.name,
    transport: ZUMPER_TRANSPORT,
    coverage: ZUMPER_COVERAGE,
    timeoutMs: 25 * 60_000,
    stepTimeout: '25 minutes',
  },
];

/**
 * Sources that read a sample, but slowly: sites that are read one page at a time with a pause, so a check takes
 * longer than an API request allows (about 25 seconds for all sources together). They run in the sync Workflow too,
 * one after another and before the long complete syncs, and each keeps the ordinary two-hour sample lifetime.
 */
type BackgroundSync = { id: string; name: string; timeoutMs: number; stepTimeout: '6 minutes' };
const background = (id: string, name: string): BackgroundSync => ({ id, name, timeoutMs: 5 * 60_000, stepTimeout: '6 minutes' });
export const BACKGROUND_SYNCS: readonly BackgroundSync[] = [
  background('apartmentguide-live', 'Apartment Guide'),
  background('nestseekers-live', 'Nest Seekers'),
  background('elliman-live', 'Douglas Elliman'),
  background('corcoran-live', 'Corcoran'),
  background('bozzuto-live', 'Bozzuto'),
  background('avalonbay-live', 'AvalonBay'),
  background('greystar-live', 'Greystar'),
  background('nooklyn-live', 'Nooklyn'),
  background('bondny-live', 'Bond New York'),
];

/** Every source the sync Workflow runs, in its order: the quick background syncs first, then the complete ones. */
export const WORKFLOW_SOURCE_IDS = [...BACKGROUND_SYNCS, ...COMPLETE_SYNCS].map(({ id }) => id);
/** How a source the Workflow runs is timed and named; undefined for sources checked within a request. */
export const workflowSync = (id: string | null | undefined): BackgroundSync | CompleteSync | undefined =>
  completeSync(id) ?? BACKGROUND_SYNCS.find((source) => source.id === id);
export const COMPLETE_SYNC_LIFETIME = 24 * 60 * 60_000;
/** Which complete sync the Workflow is on, so status can name it between steps that hold no refresh lock. */
export const SYNC_PROGRESS_KEY = 'rentals/sync-progress.json';

export const completeSync = (id: string | null | undefined) => COMPLETE_SYNCS.find((source) => source.id === id);

/**
 * Sources small enough to read whole in an ordinary refresh: landlords' own listings. Like the complete syncs,
 * a check is saved only when its count matches the total the source reports, and it is not labeled a sample.
 */
const VERIFIED_INVENTORIES: readonly { id: string; name: string; transport: string }[] = [
  { id: 'stuytown-live', name: 'StuyTown', transport: STUYTOWN_TRANSPORT },
  { id: 'glenwood-live', name: 'Glenwood', transport: GLENWOOD_TRANSPORT },
  // Brodsky lists every apartment on one page but gives no separate total; see server/sources/brodsky.ts.
  { id: 'brodsky-live', name: 'Brodsky', transport: BRODSKY_TRANSPORT },
];

/** The full-inventory rule a source follows, if any: a complete sync, or a verified inventory. */
export const fullInventory = (id: string | null | undefined): { name: string; transport: string } | undefined =>
  completeSync(id) ?? VERIFIED_INVENTORIES.find((source) => source.id === id);

/** Whether a saved snapshot is the source's complete inventory rather than a sample. */
export const isCompleteSnapshot = (id: string, transport: string | undefined) =>
  transport !== undefined && fullInventory(id)?.transport === transport;

/** Whether catalog coverage text describes a complete sync. */
export const isCompleteCoverage = (coverage: string | undefined) => COMPLETE_SYNCS.some((source) => source.coverage === coverage);

/**
 * Sites that refuse automated requests, as the weekly source check (scripts/check-sources.ts) last found from
 * cloud networks. They are not asked during a resync, so every source that is asked can answer; they stay links
 * under Rental platforms. The weekly check still reads them, so a site that starts answering is noticed: take it
 * off this list to sync it again. The app never tries to get around a refusal.
 */
export const BLOCKED_SOURCES: Readonly<Record<string, string>> = {
  'zillow-live': 'Zillow answers automated requests with HTTP 403.',
  'apartments-live': 'Apartments.com answers automated requests with HTTP 403.',
  'hotpads-live': 'HotPads answers automated requests with HTTP 403.',
  'redfin-live': 'Redfin answers automated requests with HTTP 403.',
  'realtor-live': 'Realtor.com answers automated requests with HTTP 429.',
  'renthop-live': 'RentHop answers automated requests with a bot challenge.',
  'compass-live': 'Compass answers automated requests with a bot challenge.',
};
