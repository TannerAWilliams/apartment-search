// Loaded by Bun before any test imports. Fixtures may inject fake fetch functions;
// the process-global network path is loopback-only and never follows redirects.
import { requirePinnedBun } from '../../scripts/check-runtime.ts';
import { checkWorkersFetchInit } from './workers-fetch.ts';

requirePinnedBun('The tests');
const localFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  checkWorkersFetchInit(init);
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Offline test guard blocked an external network request.');
  }
  return localFetch(input, { ...init, redirect: 'manual' });
}) as typeof fetch;
