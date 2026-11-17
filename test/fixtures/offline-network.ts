// Loaded by Bun before any test imports. Fixtures may inject fake fetch functions;
// the process-global network path is loopback-only and never follows redirects.
if (process.versions.bun !== '1.4.4') throw new Error('Tests require Bun 1.4.4.');
const localFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Offline test guard blocked an external network request.');
  }
  return localFetch(input, { ...init, redirect: 'manual' });
}) as typeof fetch;
