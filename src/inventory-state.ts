import type { SearchResult } from './domain.ts';
// A filtered zero is different from having no recently checked inventory to search.
export function inventoryUnavailable(result: Pick<SearchResult, 'mode' | 'total' | 'sources'>) {
  return result.mode === 'live' && result.total === 0 && !result.sources.some((source) => source.status === 'searched');
}
