type DisplayPriceHistory = {
  sourceId: string;
  firstObservedAt: string;
  lastObservedAt: string;
  truncated: boolean;
  observations: { checkedAt: string; rent: number; priceIncludesFees: boolean }[];
};
/** Fail closed for legacy/imported/malformed histories instead of presenting invented dates. */
export function displayPriceHistory(value: unknown): DisplayPriceHistory | null {
  if (!value || typeof value !== 'object') return null;
  const history = value as DisplayPriceHistory;
  if (typeof history.firstObservedAt !== 'string' || typeof history.lastObservedAt !== 'string') return null;
  const first = Date.parse(history.firstObservedAt),
    last = Date.parse(history.lastObservedAt);
  if (
    typeof history.sourceId !== 'string' ||
    !history.sourceId ||
    history.sourceId.length > 200 ||
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    first > last ||
    typeof history.truncated !== 'boolean' ||
    !Array.isArray(history.observations) ||
    !history.observations.length ||
    history.observations.length > 24
  )
    return null;
  let prior = first;
  for (const point of history.observations) {
    if (
      !point ||
      !Number.isFinite(point.rent) ||
      point.rent <= 0 ||
      typeof point.priceIncludesFees !== 'boolean' ||
      typeof point.checkedAt !== 'string'
    )
      return null;
    const timestamp = Date.parse(point.checkedAt);
    if (!Number.isFinite(timestamp) || timestamp < prior || timestamp > last) return null;
    prior = timestamp;
  }
  if (!history.truncated && Date.parse(history.observations[0].checkedAt) !== first) return null;
  return {
    sourceId: history.sourceId,
    firstObservedAt: history.firstObservedAt,
    lastObservedAt: history.lastObservedAt,
    truncated: history.truncated,
    observations: history.observations.map((point) => ({ ...point })),
  };
}
