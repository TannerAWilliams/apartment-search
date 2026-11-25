import type { FetchTransport } from './fetch-type.ts';
import { checkFirstMover } from '../server/sources/firstmover.ts';
import { loadHousingConnect } from '../server/sources/housing.ts';
import { PUBLIC_SOURCE_IDS } from './public-sources.ts';

/** Browser-side readers for the public exports. The app loads this module only after a source fails. */
type PullPlan = { market?: Parameters<typeof checkFirstMover>[0] };
type PublicResult = Awaited<ReturnType<typeof checkFirstMover>> | Awaited<ReturnType<typeof loadHousingConnect>>;
const PUBLIC_READERS: Record<string, (plan: PullPlan, fetcher: FetchTransport, now: Date) => Promise<PublicResult>> = {
  firstmover: (plan, fetcher) => checkFirstMover(plan.market, fetcher),
  housingconnect: (_plan, fetcher, now) => loadHousingConnect(fetcher, now),
};

export async function pullPublicSources(plan: PullPlan, fetcher: FetchTransport = fetch, now = new Date(), ids = PUBLIC_SOURCE_IDS) {
  const results = await Promise.allSettled(ids.map((id) => PUBLIC_READERS[id](plan, fetcher, now)));
  return Object.fromEntries(results.map((result, index) => [ids[index], result.status === 'fulfilled' ? result.value : null]));
}
