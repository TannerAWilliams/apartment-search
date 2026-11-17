export const LAUNDRY_OPTIONS = ['in_unit', 'in_building', 'none'] as const;
export const LAUNDRY_LABELS = { in_unit: 'In-unit laundry', in_building: 'Laundry in building', none: 'No laundry (reported)' };
function positiveNumber(value: unknown, max: number, halfSteps = false): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max && (!halfSteps || Number.isInteger(parsed * 2)) ? parsed : null;
}
/** Only explicit structured facts, never claims inferred from prose, photos or missing values. */
export type DiscoveryFacts = { bathrooms: number | null; squareFeet: number | null; petsAllowed: boolean | null; laundry: typeof LAUNDRY_OPTIONS[number] | null };
export function discoveryFacts(row: any): DiscoveryFacts {
  return {
    bathrooms: positiveNumber(row?.bathrooms, 20, true),
    squareFeet: positiveNumber(row?.squareFeet, 100000),
    petsAllowed: typeof row?.petsAllowed === 'boolean' ? row.petsAllowed : null,
    laundry: LAUNDRY_OPTIONS.includes(row?.laundry) ? row.laundry as typeof LAUNDRY_OPTIONS[number] : null,
  };
}
export function matchesDiscovery(listing: any, filters: any): boolean {
  const facts = discoveryFacts(listing);
  return !(filters.minBathrooms != null && (facts.bathrooms === null || facts.bathrooms < filters.minBathrooms)) &&
    !(filters.minSquareFeet != null && (facts.squareFeet === null || facts.squareFeet < filters.minSquareFeet)) &&
    !(filters.petsRequired === true && facts.petsAllowed !== true) &&
    !(filters.laundry && facts.laundry !== filters.laundry);
}

/** Do not fill preferred-source unknowns from another source without field provenance. */
export function mergeDiscoveryFacts(preferred: any, alternate: any) {
  const sourceIds = (listing: any) => new Set((listing.sources ?? []).map((source: { id?: string; url?: string | null }) => source.id ?? source.url).filter(Boolean));
  const first = sourceIds(preferred), second = sourceIds(alternate);
  // Without per-field provenance, overlapping merged source sets are ambiguous.
  // Only identical single-source observations are confidently same-source updates.
  const independentSources = !(first.size === 1 && second.size === 1 && [...first][0] === [...second][0]);
  const facts = discoveryFacts(preferred), other = discoveryFacts(alternate);
  const conflicts: string[] = [];
  for (const key of (Object.keys(facts) as (keyof DiscoveryFacts)[])) {
    if ((Array.isArray(preferred.discoveryConflicts) && preferred.discoveryConflicts.includes(key)) ||
        (Array.isArray(alternate.discoveryConflicts) && alternate.discoveryConflicts.includes(key)) ||
        (independentSources && facts[key] !== null && other[key] !== null && facts[key] !== other[key])) {
      facts[key] = null;
      conflicts.push(key);
    }
  }
  return { ...facts, discoveryConflicts: conflicts };
}
