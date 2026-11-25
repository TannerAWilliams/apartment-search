/**
 * Requests the page starts before the app's code has downloaded. A small script in the page (web/boot.ts, built
 * to /boot.js) asks for the settings and the opening search as soon as the HTML arrives, and the app's first two
 * requests take those answers instead of asking again: the page then waits for whichever is slower, the code
 * or the data, rather than one after the other.
 */
import type { SearchFilters } from './domain.ts';
import { EARLY_INVENTORY_FILE, type EarlyRequests, earlyKey } from './early-key.ts';
import { DEFAULT_FILTERS } from './search.ts';

/** The web app's opening search. */
export const WEB_SEARCH_DEFAULTS: SearchFilters = {
  ...DEFAULT_FILTERS,
  region: 'all',
  bedrooms: null,
  maxRent: null,
  source: '',
  // The map's points are fetched when the map is opened: on a first visit they were most of the download.
  includeMap: false,
  liveOnly: true,
  includeCached: true,
  // The web app searches every source.
  officialOnly: false,
};
const INVENTORY_FILE = '/api/inventory/';

/** The opening search's request body, as the app sends it (src/hooks/use-server.ts). */
export const openingSearchBody = () => JSON.stringify({ ...WEB_SEARCH_DEFAULTS, includeCommute: true });

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/**
 * A fetch that hands over a request the page already started, once, when it is the same request (the same address
 * and body, and not made as someone signed in by token); every other request, and any that failed early, is made now.
 */
export function withEarlyRequests(early: EarlyRequests | undefined, fetcher: Fetch): Fetch {
  return (input, init) => {
    // The inventory file's address is only known once its head has been read, so the page leaves it under one key.
    const key = input.startsWith(INVENTORY_FILE) && early?.[EARLY_INVENTORY_FILE] ? EARLY_INVENTORY_FILE : earlyKey(input, init?.body);
    const started = early?.[key];
    if (!early || !started || (init?.headers as Record<string, string> | undefined)?.Authorization) return fetcher(input, init);
    early[key] = undefined;
    // Taken when it succeeded and is the very request asked for; otherwise the request is made now.
    return started
      .then((response) =>
        response.ok && (key !== EARLY_INVENTORY_FILE || new URL(response.url).pathname === input) ? response : fetcher(input, init),
      )
      .catch(() => fetcher(input, init));
  };
}
