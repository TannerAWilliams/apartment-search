import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MARKETPLACE_NAMES } from './marketplaces.ts';
import { sourceRows, type SourceDefinition, type SourceStatus } from './source-status.ts';
import { styles } from './styles.ts';
import { Button } from './ui.tsx';
const time = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Never';
export function SourcesPage({ catalog, refresh, refreshing, onResync }: { catalog: SourceDefinition[]; refresh: { sources: SourceStatus[]; checking?: boolean } | null; refreshing: boolean; onResync: (id?: string) => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const rows = sourceRows(catalog, refresh?.sources ?? [], { ...MARKETPLACE_NAMES, settled: 'Settled.nyc' }, now);
  const busy = refreshing;
  return <View style={styles.marketplacePanel}>
    <Text accessibilityRole="header" style={styles.panelTitle}>Sources</Text>
    <Text style={styles.bodyText}>Check every source, its last attempt, and the last successful saved data. Browse-only sites are not connected feeds. Refresh failures preserve the previous data, not its freshness.</Text>
    {refresh?.checking && !refreshing && <Text style={styles.smallMuted}>A source check may still be running. Resync checks its status without starting a duplicate job.</Text>}
    <Button onPress={() => onResync()} disabled={!refresh || busy}>{busy ? 'Resync in progress…' : 'Resync all connected providers'}</Button>
    <Text style={styles.smallMuted}>Provider retry limits are respected. Some connected sources return limited samples, not their complete inventory.</Text>
    {rows.map((row) => <View key={row.id} style={styles.chartSource}>
      <Text accessibilityRole="header" style={styles.fieldLabel}>{row.name}</Text>
      <Text style={styles.smallMuted}>{row.state}{row.status?.listingCount != null ? ` · ${row.status.listingCount.toLocaleString()} saved records` : ''}</Text>
      <Text style={styles.smallMuted}>{row.coverage}</Text>
      <Text style={styles.smallMuted}>Last fetch attempt: {time(row.status?.checkedAt)}</Text>
      <Text style={styles.smallMuted}>Last successful data: {time(row.status?.updatedAt)}</Text>
      {row.status?.error && <Text style={styles.error}>{row.status.error}</Text>}
      {row.coolingDown && <Text style={styles.smallMuted}>Retry after: {time(row.status?.retryAt)}</Text>}
      <Button secondary onPress={() => onResync(row.id)} disabled={!refresh || busy || !row.resyncable || row.coolingDown}>
        {row.resyncable ? `Resync ${row.name}` : 'Resync unavailable: not connected'}
      </Button>
    </View>)}
  </View>;
}
