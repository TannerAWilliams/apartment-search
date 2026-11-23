import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MARKETPLACE_NAMES } from '../marketplaces.ts';
import { sourceCoverage, sourceRows, type SourceDefinition, type SourceStatus } from '../source-status.ts';
import { colors, styles } from '../styles.ts';
import { Button } from '../components/ui.tsx';

const time = (value?: string | null) => (value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Never');
const shortTime = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

/** A source's state as a colored dot; the words beside it always say the same thing. */
const DOT: Record<string, string> = {
  'Saved data available': '#0ca30c',
  'Last attempt failed': '#d03b3b',
  'Sync paused': '#fab219',
  'Not fetched yet': '#c3c2b7',
};

type Row = ReturnType<typeof sourceRows>[number];

function SourceRow({ row, first, disabled, onResync }: { row: Row; first: boolean; disabled: boolean; onResync: () => void }) {
  const [open, setOpen] = useState(false);
  const count = row.status?.listingCount;
  const summary = [
    row.state === 'Saved data available' && count != null ? '' : row.state,
    count != null ? `${count.toLocaleString('en-US')} listings` : '',
    row.status?.updatedAt ? shortTime(row.status.updatedAt) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }, !first && styles.menuDivider]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: DOT[row.state] ?? '#c3c2b7' }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${row.name}: ${summary}. ${open ? 'Hide' : 'Show'} details`}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          style={{ flex: 1, minWidth: 0, gap: 1 }}
        >
          <Text style={styles.fieldLabel}>
            {row.name} <Text style={{ color: '#a3afbf' }}>{open ? '▴' : '▾'}</Text>
          </Text>
          <Text style={styles.smallMuted}>{summary}</Text>
        </Pressable>
        <Button
          secondary
          label={row.paused ? 'Sync paused' : `Resync ${row.name}`}
          onPress={onResync}
          disabled={disabled || row.paused || row.coolingDown}
        >
          {row.paused ? 'Paused' : 'Resync'}
        </Button>
      </View>
      {row.status?.error && <Text style={[styles.smallMuted, { color: '#a12f2a' }]}>{row.status.error}</Text>}
      {row.coolingDown && <Text style={styles.smallMuted}>Retry after {time(row.status?.retryAt)}</Text>}
      {open && (
        <View style={{ gap: 3 }}>
          {row.coverage ? <Text style={styles.smallMuted}>Covers: {row.coverage}</Text> : null}
          {sourceCoverage(row.status) !== '' && <Text style={styles.smallMuted}>{sourceCoverage(row.status)}</Text>}
          <Text style={styles.smallMuted}>Last fetch attempt: {time(row.status?.checkedAt)}</Text>
          <Text style={styles.smallMuted}>Last successful data: {time(row.status?.updatedAt)}</Text>
        </View>
      )}
    </View>
  );
}

export function SourcesPage({
  catalog,
  refresh,
  refreshing,
  cooldownSeconds = 0,
  onResync,
}: {
  catalog: SourceDefinition[];
  refresh: { sources: SourceStatus[]; checking?: boolean } | null;
  refreshing: boolean;
  cooldownSeconds?: number;
  onResync: (id?: string) => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const rows = sourceRows(catalog, refresh?.sources ?? [], { ...MARKETPLACE_NAMES, settled: 'Settled.nyc' }, now);
  const connected = rows.filter((row) => row.resyncable || row.paused);
  const browseOnly = rows.filter((row) => !row.resyncable && !row.paused);
  const busy = refreshing || cooldownSeconds > 0;
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.bodyText}>
        Where listings come from. Resync checks each site again; if one fails, its last good listings are kept.
      </Text>
      {refresh?.checking && !refreshing && (
        <Text style={styles.smallMuted}>A check may still be running. Resync checks its status without starting a second one.</Text>
      )}
      <Button onPress={() => onResync()} disabled={!refresh || busy}>
        {refreshing
          ? 'Resync in progress…'
          : cooldownSeconds > 0
            ? `Resync available in ${cooldownSeconds}s`
            : 'Resync all connected providers'}
      </Button>
      <View style={styles.menu}>
        {connected.map((row, index) => (
          <SourceRow key={row.id} row={row} first={index === 0} disabled={!refresh || busy} onResync={() => onResync(row.id)} />
        ))}
      </View>
      {browseOnly.length > 0 && (
        <Text style={styles.smallMuted}>
          {browseOnly.length} more sites, such as{' '}
          {browseOnly
            .slice(0, 3)
            .map(({ name }) => name)
            .join(', ')}
          , aren’t read by the app; open them from Rental platforms.
        </Text>
      )}
      <Text style={[styles.smallMuted, { color: colors.muted }]}>
        Some sites return a sample rather than every listing; each source’s details say which.
      </Text>
    </View>
  );
}
