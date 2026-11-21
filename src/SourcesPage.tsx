import { workflowPending, type RefreshWorkflow } from './refresh-workflow.ts';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MARKETPLACE_NAMES } from './marketplaces.ts';
import { sourceCoverage, sourceRows, type SourceDefinition, type SourceStatus } from './source-status.ts';
import { styles } from './styles.ts';
import { Button } from './ui.tsx';
const time = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Never';
export function SourcesPage({ catalog, refresh, refreshing, cooldownSeconds = 0, onResync, retryingWorkflow, onRetryWorkflow, refreshNotice }: { catalog: SourceDefinition[]; refresh: { sources: SourceStatus[]; checking?: boolean; workflow?: RefreshWorkflow } | null; refreshing: boolean; cooldownSeconds?: number; onResync: (id?: string) => void; retryingWorkflow?: boolean; onRetryWorkflow?: (id: string) => void; refreshNotice?: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const rows = sourceRows(catalog, refresh?.sources ?? [], { ...MARKETPLACE_NAMES, settled: 'Settled.nyc' }, now);
  const busy = refreshing || workflowPending(refresh?.workflow) || cooldownSeconds > 0;
  return <View style={styles.marketplacePanel}>
    <Text accessibilityRole="header" style={styles.panelTitle}>Sources</Text>
    <Text style={styles.bodyText}>Check every source, its last attempt, and the last successful saved data. Browse-only sites are not connected feeds. Refresh failures preserve the previous data, not its freshness.</Text>
    {refreshNotice && <Text accessibilityRole="alert" style={styles.bodyText}>{refreshNotice}</Text>}
    {refresh?.workflow && <Text style={styles.bodyText}>Background sync {refresh.workflow.id}: {refresh.workflow.status}. Sources: {refresh.workflow.sources.map(id => catalog.find(source => source.id === id)?.name ?? id).join(', ')}. {workflowPending(refresh.workflow) ? 'The server keeps this run across page reloads. This page checks its progress; closing it does not cancel the run.' : 'This is the latest saved run status.'}</Text>}
    {refresh?.workflow?.status === 'unknown' && <Text style={styles.bodyText}>The server cannot confirm this run’s status yet. No failure or new run is assumed. Keep this page open or reopen it later to check the same run.</Text>}
    {refresh?.workflow?.canRetryStart && onRetryWorkflow && <Button disabled={retryingWorkflow} onPress={() => onRetryWorkflow(refresh.workflow!.id)}>
      {retryingWorkflow ? 'Retrying this background run…' : 'Retry this background run'}
    </Button>}
    {refresh?.workflow?.status === 'paused' && <Text style={styles.bodyText}>The server reports this run is paused. A new resync will not replace it.</Text>}
    {refresh?.checking && !refreshing && <Text style={styles.smallMuted}>A source check may still be running. Resync checks its status without starting a duplicate job.</Text>}
    <Button onPress={() => onResync()} disabled={!refresh || busy}>{refreshing ? 'Resync in progress…' : cooldownSeconds > 0 ? `Resync available in ${cooldownSeconds}s` : 'Resync all connected providers'}</Button>
    <Text style={styles.smallMuted}>Provider retry limits are respected. Some connected sources return limited samples, not their complete inventory.</Text>
    {rows.map((row) => <View key={row.id} style={styles.chartSource}>
      <Text accessibilityRole="header" style={styles.fieldLabel}>{row.name}</Text>
      <Text style={styles.smallMuted}>{row.state}{row.status?.listingCount != null ? ` · ${row.status.listingCount.toLocaleString()} saved records` : ''}</Text>
      <Text style={styles.smallMuted}>{row.coverage}</Text>
      {sourceCoverage(row.status) !== '' && <Text style={styles.smallMuted}>{sourceCoverage(row.status)}</Text>}
      <Text style={styles.smallMuted}>Last fetch attempt: {time(row.status?.checkedAt)}</Text>
      <Text style={styles.smallMuted}>Last successful data: {time(row.status?.updatedAt)}</Text>
      {row.status?.error && <Text style={styles.error}>{row.status.error}</Text>}
      {row.coolingDown && <Text style={styles.smallMuted}>Retry after: {time(row.status?.retryAt)}</Text>}
      <Button secondary onPress={() => onResync(row.id)} disabled={!refresh || busy || !row.resyncable || row.coolingDown}>
        {row.paused ? 'Sync paused' : row.resyncable ? `Resync ${row.name}` : 'Resync unavailable: not connected'}
      </Button>
    </View>)}
  </View>;
}

