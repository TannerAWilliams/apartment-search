/** Process-local limits for the single free Render instance. Reset on restart. */
export function createPublicRequestLimits(now = Date.now) {
  let refreshAfter = 0;
  let windowEnds = 0;
  let requests = 0;
  return {
    allowApi(): boolean {
      if (now() >= windowEnds) { windowEnds = now() + 60_000; requests = 0; }
      return ++requests <= 240;
    },
    refreshRetrySeconds(): number {
      const remaining = Math.ceil((refreshAfter - now()) / 1000);
      if (remaining > 0) return remaining;
      refreshAfter = now() + 60_000;
      return 0;
    },
  };
}

/** Anonymous callers can request a fetch, never inject/overwrite listing data. */
export function isPublicRefresh(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return value.check === 'now' && Object.keys(value).every((key) => ['check', 'source', 'sessionStart'].includes(key))
    && (value.source === undefined || typeof value.source === 'string')
    && (value.sessionStart === undefined || typeof value.sessionStart === 'boolean');
}
