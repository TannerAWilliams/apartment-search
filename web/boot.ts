/**
 * Runs as soon as the page's HTML arrives, before the app's code (about 200 KB) has downloaded: asks for the
 * settings, the inventory's head (which carries the opening search's answer), the inventory file itself and, on
 * an apartment's own address, that apartment, all of which the app takes over instead of asking again (src/early-requests.ts). Built to /boot.js by
 * scripts/build-service-worker.ts; it loads none of the app's code.
 */
import { EARLY_INVENTORY_FILE, earlyKey, type EarlyRequests } from '../src/early-key.ts';

const head = fetch('/api/inventory');
const early: EarlyRequests = {
  [earlyKey('/api/config')]: fetch('/api/config'),
  // A copy for the app; this script reads the original for the file's version.
  [earlyKey('/api/inventory')]: head.then((response) => response.clone()),
  [EARLY_INVENTORY_FILE]: head
    .then((response) => (response.ok ? (response.json() as Promise<{ version: string }>) : Promise.reject(new Error('No inventory file.'))))
    .then(({ version }) => fetch('/api/inventory/' + version)),
};
// An apartment's own address (a shared link): its stored listing, which the page shows first.
const listing = /^\/listing\/(.+)$/.exec(location.pathname)?.[1];
if (listing) {
  try {
    const url = '/api/listing/stored?' + new URLSearchParams({ id: decodeURIComponent(listing) });
    early[earlyKey(url)] = fetch(url);
  } catch {
    // An address that does not decode is the app's to report.
  }
}
// A failure is the app's to handle when it takes the request over.
for (const request of Object.values(early)) request?.catch(() => {});
(globalThis as { walkupEarly?: EarlyRequests }).walkupEarly = early;
