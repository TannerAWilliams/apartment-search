/** Never replace server-backed active inventory with a synthetic local empty search. */
export function searchAvailabilityMessage(state: string): string | null {
  if (state === 'ready') return null;
  if (state === 'checking') return 'Still connecting to the search server. Wait for the connection, then press Search or Apply again. Your previous results and destination have not changed.';
  if (state === 'locked') return 'Unlock the search server before searching. Your previous results and destination have not changed.';
  return 'The search server is unavailable. Retry the connection, then press Search or Apply again. Your previous results and destination have not changed.';
}
