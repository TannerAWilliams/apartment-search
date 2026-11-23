import { parseFilters } from './search.ts';
import { isRecord } from './domain.ts';
import { parseChangeBaseline, MAX_BASELINE_UNITS, type ChangeBaseline, type ObservedChange, type ObservedUnit } from './observed-changes.ts';
export const MAX_SAVED_SEARCHES = 10;
export type SavedSearch = { id: string; name: string; filters: ReturnType<typeof parseFilters>; baseline: ChangeBaseline | null; lastCheckedAt: string | null };
export type WholeSearchSnapshot = { scope: 'all-cached-search-matches'; total: number; eligible: number; observations: ObservedUnit[]; checkedAt: string; notices: string[] };
export function presetFilters(value: unknown) {
  return { ...parseFilters(value), offset: 0, includeMap: false, includeCommute: false };
}
export function readSavedSearches(raw: string | null): SavedSearch[] {
  if (raw === null) return [];
  if (raw.length > 40 * 1024 * 1024) throw new Error('Saved searches exceed device limits.');
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.searches) || value.searches.length > MAX_SAVED_SEARCHES) throw new Error('Saved searches could not be read.');
  const ids = new Set(), names = new Set();
  return value.searches.map((item: unknown) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id) ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.length > 60 || names.has(item.name.trim().toLowerCase()) ||
      !(item.lastCheckedAt === null || (typeof item.lastCheckedAt === 'string' && item.lastCheckedAt.length <= 64 && Number.isFinite(Date.parse(item.lastCheckedAt))))) throw new Error('Invalid saved search.');
    ids.add(item.id); names.add(item.name.trim().toLowerCase());
    return { id: item.id, name: item.name.trim(), filters: presetFilters(item.filters),
      baseline: item.baseline === null ? null : parseChangeBaseline(JSON.stringify(item.baseline)), lastCheckedAt: item.lastCheckedAt };
  });
}
export function serializeSavedSearches(searches: SavedSearch[]) {
  const raw = JSON.stringify({ version: 1, searches });
  readSavedSearches(raw); // Never write a document that cannot be read back.
  return raw;
}
export function addSavedSearch(searches: SavedSearch[], name: string, filters: unknown, id: string): SavedSearch[] {
  const next = [...searches, { id, name: name.trim(), filters: presetFilters(filters), baseline: null, lastCheckedAt: null }];
  return readSavedSearches(serializeSavedSearches(next));
}
export function parseWholeSnapshot(value: unknown): WholeSearchSnapshot {
  if (!isRecord(value) || value.scope !== 'all-cached-search-matches' || typeof value.total !== 'number' || !Number.isInteger(value.total) || value.total < 0 || value.total > MAX_BASELINE_UNITS ||
      typeof value.eligible !== 'number' || !Number.isInteger(value.eligible) || value.eligible < 0 || value.eligible > value.total || typeof value.checkedAt !== 'string' || value.checkedAt.length > 64 || !Number.isFinite(Date.parse(value.checkedAt)) ||
      !Array.isArray(value.notices) || value.notices.some((notice: unknown) => typeof notice !== 'string')) throw new Error('Incomplete whole-search response.');
  const baseline = parseChangeBaseline(JSON.stringify({ version: 1, observations: value.observations, truncated: false }))!;
  if (baseline.observations.length !== value.eligible) throw new Error('Observation count mismatch.');
  return { scope: value.scope, total: value.total, eligible: value.eligible, observations: baseline.observations, checkedAt: value.checkedAt, notices: value.notices as string[] };
}
export function compareWholeSnapshot(value: unknown, previous: ChangeBaseline | null) {
  const snapshot = parseWholeSnapshot(value);
  const old = new Map((previous?.observations ?? []).map(item => [item.key, item]));
  const next = new Map(old);
  const changes: ObservedChange[] = [];
  for (const current of snapshot.observations) {
    const prior = old.get(current.key);
    if (prior && Date.parse(current.checkedAt) <= Date.parse(prior.checkedAt)) continue;
    if (previous) {
      if (!prior) changes.push({ kind: 'newly_encountered', current });
      else if (prior.includesFees !== current.includesFees) changes.push({ kind: 'fee_basis', current, previous: prior });
      else if (prior.rent !== current.rent) changes.push({ kind: 'price', current, previous: prior });
    }
    next.set(current.key, current);
  }
  const records = [...next.values()].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
  const baseline: ChangeBaseline = { version: 1, observations: records.slice(0, MAX_BASELINE_UNITS), truncated: Boolean(previous?.truncated || records.length > MAX_BASELINE_UNITS) };
  return { snapshot, changes, baseline };
}
