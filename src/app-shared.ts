/** Settings, defaults and helpers the app's screens share. */
import { createApi, type RefreshInfo } from './api-client.ts';
import type { SearchFilters, SearchResult } from './domain.ts';

import { Platform } from 'react-native';
import { REGIONS } from './regions.ts';
import { DEFAULT_FILTERS } from './search.ts';
import { LONG_SYNC_LIMITS, LONG_SYNC_POLL_MS } from './source-status.ts';

export type DraftFilters = Omit<
  SearchFilters,
  'maxRent' | 'maxTransitMinutes' | 'maxDrivingMinutes' | 'minBathrooms' | 'minSquareFeet' | 'bestFitRentWeight'
> & {
  maxRent: string | number | null;
  maxTransitMinutes: string | number | null;
  maxDrivingMinutes: string | number | null;
  minBathrooms: string | number | null;
  minSquareFeet: string | number | null;
  bestFitRentWeight: string | number;
};
export const failureInfo = (value: unknown) => ({
  message: value instanceof Error ? value.message : '',
  commuteError: typeof value === 'object' && value !== null && 'commuteError' in value && value.commuteError === true,
  refreshRetryAt:
    typeof value === 'object' && value !== null && 'refreshRetryAt' in value && typeof value.refreshRetryAt === 'number'
      ? value.refreshRetryAt
      : 0,
});

/** The deployed server, which the native app uses unless EXPO_PUBLIC_API_URL names another (such as a local one). */
const PRODUCTION_ORIGIN = 'https://apartments.5thof6.com';
export const API_ORIGIN = Platform.OS === 'web' ? '' : process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || PRODUCTION_ORIGIN;
export const WEB_MAP = Platform.OS === 'web';
export const SEARCH_DEFAULTS: SearchFilters = {
  ...DEFAULT_FILTERS,
  region: 'all',
  bedrooms: null,
  maxRent: null,
  source: '',
  // The map's points are fetched when the map is opened: on a first visit they were most of the download.
  includeMap: false,
  liveOnly: true,
  includeCached: true,
  // The App Store app searches official feeds and open data only; the web app searches every source.
  officialOnly: Platform.OS !== 'web',
};
export const BEDROOMS = [null, 0, 1, 2, 3, 4];
export const PAGE_SIZE = 12;
/** Area chips under headings: the city and its boroughs, then the surrounding regions. */
export const AREA_GROUPS: [string, (keyof typeof REGIONS)[]][] = [
  ['New York City', ['nyc', 'manhattan-brooklyn', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island']],
  ['Around NYC', ['nj', 'li', 'westchester', 'metroNorth', 'ct']],
];
/** Secondary tools per tab, as [id, chip label, accessible name]. Each name starts with its visible label. */
export const TOOLS: Record<'results' | 'saved', [string, string, string][]> = {
  results: [
    ['searches', 'Saved searches', 'Saved searches and whole-search checks'],
    ['changes', 'Price changes', 'Price changes found by a local check'],
  ],
  saved: [
    ['compare', 'Compare', 'Compare saved apartments'],
    ['tours', 'Plan tours', 'Plan tours of saved apartments'],
  ],
};
export const EMPTY_POINTS: NonNullable<SearchResult['mapPoints']> = [];
export const SAVED_FILTERS = { ...SEARCH_DEFAULTS, bedrooms: null, maxRent: null, liveOnly: false };
export const CHECK_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export const formDefaults = (): DraftFilters => ({
  ...SEARCH_DEFAULTS,
  maxRent: SEARCH_DEFAULTS.maxRent == null ? '' : String(SEARCH_DEFAULTS.maxRent),
  maxTransitMinutes: '',
  maxDrivingMinutes: '',
});

export const api = createApi(API_ORIGIN);

export async function finishSourceCheck(
  check: RefreshInfo,
  token: string,
  signal?: AbortSignal,
  onProgress?: (check: RefreshInfo) => void,
) {
  const started = Date.now();
  // A background complete sync (CityRealty, Openigloo, Zumper) can take many minutes; check on it less often.
  let longSyncLimit = 0;
  while (check.checking) {
    longSyncLimit = Math.max(longSyncLimit, LONG_SYNC_LIMITS[check.activeSource ?? ''] ?? 0);
    if (Date.now() - started >= (longSyncLimit || 150_000)) break;
    // biome-ignore lint/performance/noAwaitInLoops: polling: each check waits, then asks how the sync is going
    await new Promise((resolve) => setTimeout(resolve, longSyncLimit ? LONG_SYNC_POLL_MS : 1200));
    if (signal?.aborted) return check;
    // biome-ignore lint/performance/noAwaitInLoops: polling, as above
    check = await api('refresh', { token, signal });
    onProgress?.(check);
  }
  if (check.checking) throw new Error('The source check is still running.');
  return check;
}
