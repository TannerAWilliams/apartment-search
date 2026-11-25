/**
 * Runs as soon as the page's HTML arrives, before the app's code (about 200 KB) has downloaded: asks for the
 * settings and the opening search, which the app then takes instead of asking again (src/early-requests.ts).
 * Built to /boot.js by scripts/build-service-worker.ts.
 */
import { earlyKey, type EarlyRequests } from '../src/early-key.ts';

/** The opening search's request body, written in when this file is built (src/early-requests.ts), so none of the app's code is loaded here. */
declare const OPENING_SEARCH_BODY: string;

const early: EarlyRequests = {};
early[earlyKey('/api/config')] = fetch('/api/config');
let ownDestination = false;
try {
  // With a saved commute destination the opening search is a different one, which the app makes itself.
  ownDestination = localStorage.getItem('walkup.commute-place') !== null;
} catch {
  // Storage can be blocked; the default search is then the right one.
}
if (!ownDestination) {
  const body = OPENING_SEARCH_BODY;
  early[earlyKey('/api/search', body)] = fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
}
// A failure is the app's to report when it takes the request over.
for (const request of Object.values(early)) request?.catch(() => {});
(globalThis as { walkupEarly?: EarlyRequests }).walkupEarly = early;
