/** A server-supplied deadline describes the observations used for this result, not when it was downloaded. */
export function inventoryExpired(result: { mode?: string; inventoryExpiresAt?: string }, now = Date.now()): boolean {
  if (result.mode !== 'live' || result.inventoryExpiresAt === undefined) return false;
  const deadline = Date.parse(result.inventoryExpiresAt);
  return !Number.isFinite(deadline) || !Number.isFinite(now) || now > deadline;
}
