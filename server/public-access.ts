/** Anonymous callers of a public app can request a check, never inject or overwrite listing data. */
export function isPublicRefresh(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  return value.check === 'now' && Object.keys(value).every((key) => ['check', 'source', 'sessionStart'].includes(key))
    && (value.source === undefined || typeof value.source === 'string')
    && (value.sessionStart === undefined || typeof value.sessionStart === 'boolean');
}
