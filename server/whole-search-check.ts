import { localWorkplace, needsCommute, parseFilters, SearchInputError } from '../src/search.ts';
import { checkObservedChanges, MAX_BASELINE_UNITS } from '../src/observed-changes.ts';
import type { ListingData, SearchFilters, SourceStatus } from '../src/domain.ts';
import type { AppEnv } from './contracts.ts';

/** A bounded, coherent read of all matching cached inventory, never a source refresh. */
export async function wholeSearchCheck(raw: unknown, env: AppEnv,
  load: (filters: SearchFilters) => Promise<{ matches: ListingData[]; notices?: string[]; sources?: SourceStatus[] }>) {
  if (!env.BUCKET) throw new SearchInputError('Saved inventory is unavailable. No baseline was changed.');
  const filters = parseFilters(raw);
  if (needsCommute(filters)) throw new SearchInputError('Whole-search checks cannot run commute-time filters or sorts without requesting routing. Use a search without commute-time requirements.');
  if (!localWorkplace(filters)) throw new SearchInputError('Use a workplace preset or coordinates for whole-search checks. Custom addresses need a separate geocoding request.');
  const before = await env.BUCKET.get('rentals/refresh.json');
  if (before && (await before.json<{ running?: boolean }>()).running) throw new SearchInputError('A source refresh is running. Wait until it finishes, then check again.');
  const result = await load({ ...filters, offset: 0, includeMap: false, includeCommute: false });
  const after = await env.BUCKET.get('rentals/refresh.json');
  if ((before?.etag ?? null) !== (after?.etag ?? null) || (after && (await after.json<{ running?: boolean }>()).running)) throw new SearchInputError('Inventory changed while checking. Retry; no baseline was changed.');
  if (result.matches.length > MAX_BASELINE_UNITS) throw new SearchInputError(`This search has more than ${MAX_BASELINE_UNITS.toLocaleString('en-US')} matching cached apartments. Narrow the search; partial results will not replace its baseline.`);
  const observed = checkObservedChanges(result.matches, null);
  return { scope: 'all-cached-search-matches', total: result.matches.length, eligible: observed.eligible,
    observations: observed.baseline.observations, checkedAt: new Date().toISOString(),
    notices: result.notices ?? [], sources: result.sources ?? [] };
}
