import { createInterface } from 'node:readline';
import { loadOpenigloo } from '../server/openigloo.mjs';
import { encodeSourceImport, pullPublicSources } from '../src/pull-sources.mjs';

const origin = 'https://apartment-search-metro-nyc.adepthen22.chatgpt.site';
const input = createInterface({ input: process.stdin });
const token = await new Promise((resolve) => input.once('line', resolve));
input.close();
process.stdin.pause();

async function request(path, body) {
  const headers = { 'OAI-Sites-Authorization': 'Bearer ' + token };
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(origin + path, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok && !result.sources) throw new Error('Apartment Search returned HTTP ' + response.status);
  return result;
}

const plan = await request('/api/refresh');
if (!plan.ready) throw new Error('Hosted refresh storage is unavailable.');
let outcome = plan;
if (!plan.alreadyChecked) {
  const [sources, openigloo] = await Promise.all([pullPublicSources(plan), loadOpenigloo().catch(() => null)]);
  outcome = await request('/api/refresh', encodeSourceImport({ ...sources, openigloo }));
}
const config = await request('/api/config');
const status = config.refresh;
if (!status?.lastCheckedAt || status.lastCheckedAt !== outcome.lastCheckedAt) {
  throw new Error('The refresh status could not be verified after the update.');
}
const failed = status.sources.filter(({ status: state }) => state === 'failed').map(({ name }) => name);
console.log(JSON.stringify({ lastCheckedAt: status.lastCheckedAt, sources: status.sources, failed }));
process.exit(failed.length > 0 ? 2 : 0);
