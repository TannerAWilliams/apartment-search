export type SourceStatus = { id: string; name?: string; marketplace?: string; status?: string; checkedAt?: string; updatedAt?: string; retryAt?: string; error?: string; listingCount?: number };
export type SourceDefinition = { id: string; name: string; marketplace?: string; coverage?: string; resyncable: boolean };
export function sourceRows(catalog: SourceDefinition[], statuses: SourceStatus[], browseNames: Record<string, string>, now = Date.now()) {
  const definitions = new Map(catalog.map((source) => [source.id, source]));
  const represented = new Set(catalog.map((source) => source.marketplace ?? source.id.replace(/-live$/, '')));
  for (const status of statuses) if (!definitions.has(status.id)) definitions.set(status.id, { id: status.id, name: status.name ?? status.id, resyncable: false });
  for (const [id, name] of Object.entries(browseNames)) if (!represented.has(id)) definitions.set('browse:' + id, { id: 'browse:' + id, name, coverage: 'Browse link only; no data connection', resyncable: false });
  return [...definitions.values()].map((definition) => {
    const status = statuses.find((item) => item.id === definition.id);
    const coolingDown = Date.parse(status?.retryAt ?? '') > now;
    return { ...definition, status, coolingDown,
      state: !definition.resyncable ? 'Not connected' : status?.status === 'failed' ? 'Last attempt failed' : status?.updatedAt ? 'Saved data available' : 'Not fetched yet' };
  }).sort((a, b) => Number(b.resyncable) - Number(a.resyncable) || a.name.localeCompare(b.name));
}
