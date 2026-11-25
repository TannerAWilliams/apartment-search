/**
 * Public exports the browser can fetch itself when the Worker could not (see pull-sources.ts). Kept apart from
 * the compression in source-import.ts, so the app's first download does not carry the compressor.
 */
export const PUBLIC_SOURCE_IDS = ['firstmover', 'housingconnect'];

export function retryablePublicSources(check: { sources?: { id: string; status?: string; retryAt?: string | null }[] }, now = new Date()) {
  return (check.sources ?? [])
    .filter(
      ({ id, status, retryAt }) => PUBLIC_SOURCE_IDS.includes(id) && status === 'failed' && !(Date.parse(retryAt ?? '') > now.getTime()),
    )
    .map(({ id }) => id);
}
