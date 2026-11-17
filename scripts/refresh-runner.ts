import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';
import { encodeSourceImport, pullPublicSources, retryablePublicSources } from '../src/pull-sources.ts';

type RunnerSource = { id: string; name: string; status: string; retryAt?: string };
type RunnerResponse = { ready?: boolean; checking?: boolean; lastCheckedAt?: string; sources: RunnerSource[]; market?: { revision?: string; catalogEtag?: string; csvEtag?: string } | null; refresh?: { lastCheckedAt?: string; sources: RunnerSource[] } };

const origin = 'https://apartment-search-metro-nyc.adepthen22.chatgpt.site';
const input = createInterface({ input: process.stdin });
const token = await new Promise<string>((resolve) => input.once('line', resolve));
input.close();
process.stdin.pause();

async function request(path: string, body?: object) {
  const headers: Record<string, string> = { 'OAI-Sites-Authorization': 'Bearer ' + token };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + path, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  const result = await response.json() as RunnerResponse;
  if (!response.ok && !result.sources) throw new Error('Apartment Search returned HTTP ' + response.status);
  return result;
}

async function waitForCheck(result: RunnerResponse) {
  for (let attempt = 0; result.checking && attempt < 25; attempt += 1) {
    await setTimeout(1200);
    result = await request('/api/refresh');
  }
  if (result.checking) throw new Error('The source check is still running.');
  return result;
}

const plan = await request('/api/refresh');
if (!plan.ready) throw new Error('Hosted refresh storage is unavailable.');
let outcome = await waitForCheck(await request('/api/refresh', { check: 'now' }));
if (retryablePublicSources(outcome).length) {
  const latest = await request('/api/refresh');
  const exports = await pullPublicSources(latest, fetch, new Date(), retryablePublicSources(latest));
  const recovered = Object.fromEntries(Object.entries(exports).filter(([, data]) => data));
  if (Object.keys(recovered).length) {
    outcome = await waitForCheck(await request('/api/refresh', { ...encodeSourceImport(recovered), fallback: true }));
  }
}
const config = await request('/api/config');
const status = config.refresh;
if (!status || !(Date.parse(status.lastCheckedAt ?? '') >= Date.parse(outcome.lastCheckedAt ?? ''))) {
  throw new Error('The refresh status could not be verified after the update.');
}
const failed = status.sources.filter(({ status: state }) => state === 'failed').map(({ name }) => name);
console.log(JSON.stringify({ lastCheckedAt: status.lastCheckedAt, sources: status.sources, failed }));
process.exit(failed.length > 0 ? 2 : 0);
