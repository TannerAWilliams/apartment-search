import { isRecord, type ListingData, type Loose } from './domain.ts';
import { listingKey } from './listings.ts';
import { displayPriceHistory } from './price-history.ts';
export type ObservedUnit = { key: string; label: string; sourceId: string; checkedAt: string; rent: number; includesFees: boolean };
export type ChangeBaseline = { version: 1; observations: ObservedUnit[]; truncated: boolean };
export type ObservedChange = { kind: 'newly_encountered' | 'price' | 'fee_basis'; current: ObservedUnit; previous?: ObservedUnit };
export const MAX_BASELINE_UNITS = 2000;
function validObservation(item: unknown): item is ObservedUnit {
  return (
    isRecord(item) &&
    typeof item.key === 'string' &&
    !!item.key &&
    item.key.length <= 1000 &&
    typeof item.label === 'string' &&
    item.label.length <= 500 &&
    typeof item.sourceId === 'string' &&
    !!item.sourceId &&
    item.sourceId.length <= 200 &&
    typeof item.checkedAt === 'string' &&
    item.checkedAt.length <= 64 &&
    Number.isFinite(Date.parse(item.checkedAt)) &&
    typeof item.rent === 'number' &&
    Number.isFinite(item.rent) &&
    item.rent > 0 &&
    item.rent <= 100000 &&
    typeof item.includesFees === 'boolean'
  );
}
export function parseChangeBaseline(raw: string | null): ChangeBaseline | null {
  if (raw === null) return null;
  // Above the worst-case escaped JSON size allowed by the bounded record schema.
  if (raw.length > 32 * 1024 * 1024) throw new Error('Change baseline is too large.');
  const value = JSON.parse(raw);
  const { version, truncated, observations }: Loose<ChangeBaseline> = isRecord(value) ? value : {};
  if (
    version !== 1 ||
    typeof truncated !== 'boolean' ||
    !Array.isArray(observations) ||
    observations.length > MAX_BASELINE_UNITS ||
    !observations.every(validObservation)
  )
    throw new Error('Invalid change baseline.');
  const keys = new Set<string>();
  for (const item of observations) {
    if (keys.has(item.key)) throw new Error('Invalid change baseline.');
    keys.add(item.key);
  }
  return { version, truncated, observations };
}
/** What names a listing's observations from one source, in a baseline and in the changes found against it. */
export const observedKey = (listing: ListingData, sourceId: string) => JSON.stringify([listingKey(listing), sourceId]);

export function checkObservedChanges(listings: ListingData[], baseline: ChangeBaseline | null) {
  const previous = new Map((baseline?.observations ?? []).map((item) => [item.key, item]));
  const next = new Map(previous);
  const changes: ObservedChange[] = [];
  let eligible = 0;
  const seen = new Set<string>();
  for (const listing of listings) {
    const history = displayPriceHistory(listing.priceHistory);
    const latest = history?.observations.at(-1);
    if (
      !history ||
      !latest ||
      latest.rent > 100000 ||
      latest.rent !== listing.rent ||
      latest.priceIncludesFees !== (listing.priceIncludesFees === true)
    )
      continue;
    const key = observedKey(listing, history.sourceId);
    if (seen.has(key)) continue;

    const current: ObservedUnit = {
      key,
      label: [listing.address, listing.unit ? `Unit ${listing.unit}` : '', listing.city].filter(Boolean).join(', '),
      sourceId: history.sourceId,
      checkedAt: history.lastObservedAt,
      rent: latest.rent,
      includesFees: latest.priceIncludesFees,
    };
    if (!validObservation(current)) continue;
    seen.add(key);
    eligible++;
    const old = previous.get(key);
    // Older/equal snapshots cannot roll back a baseline or manufacture changes.
    if (old && Date.parse(current.checkedAt) <= Date.parse(old.checkedAt)) continue;
    if (baseline) {
      if (!old) changes.push({ kind: 'newly_encountered', current });
      else if (old.includesFees !== current.includesFees) changes.push({ kind: 'fee_basis', current, previous: old });
      else if (old.rent !== current.rent) changes.push({ kind: 'price', current, previous: old });
    }
    next.set(key, current);
  }
  const records = [...next.values()].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
  return {
    eligible,
    changes,
    baseline: {
      version: 1 as const,
      observations: records.slice(0, MAX_BASELINE_UNITS),
      truncated: Boolean(baseline?.truncated || records.length > MAX_BASELINE_UNITS),
    },
  };
}
