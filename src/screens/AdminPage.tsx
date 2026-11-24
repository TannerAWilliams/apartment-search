/** The admin dashboard (server/admin.ts): members and plans, payments, alerts, public data, sources and runs. */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { formatRent } from '../search.ts';
import { colors, styles } from '../styles.ts';

type Run = { at: string; updated: number; failed: number } | null;
type Loaded = { checkedAt: string | null; count: number };
export type AdminStats = {
  members: { total: number; paid: number; free: number };
  payments: { monthly: number; passes: number; estimatedMonthlyRevenue: number };
  alerts: { rules: number; accounts: number; devices: number; sentThisWeek: number };
  data: { stabilizedBuildings: Loaded; subwayStations: Loaded; buildingsChecked: number };
  sources: { total: number; failed: string[]; lastCheckedAt: string | null };
  runs: { nightly: Run; daytime: Run };
  funnel?: { days: number; signups: number; search: number; save: number; alert: number; checkout: number; paid: number };
};

const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString('en-US') : 'never');
const run = (value: Run) => (value ? `${when(value.at)}: ${value.updated} updated, ${value.failed} failed` : 'not yet');
const count = (value: number) => value.toLocaleString('en-US');

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <View style={[styles.chartCard, { flexGrow: 1, flexBasis: 150 }]}>
      <Text style={styles.smallMuted}>{label}</Text>
      <Text style={styles.chartTitle}>{value}</Text>
      {detail ? <Text style={styles.smallMuted}>{detail}</Text> : null}
    </View>
  );
}

export function AdminPage({ load, onError }: { load?: () => Promise<AdminStats>; onError: (message: string) => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  useEffect(() => {
    load?.()
      .then(setStats)
      .catch((error) => onError(error instanceof Error ? error.message : 'The dashboard could not be loaded.'));
  }, [load, onError]);
  return (
    <View style={styles.marketplacePanel}>
      <Text accessibilityRole="header" style={styles.chartTitle}>
        Dashboard
      </Text>
      {!stats ? (
        <Text style={styles.smallMuted}>{load ? 'Loading…' : 'The dashboard needs the server.'}</Text>
      ) : (
        <>
          <View style={[styles.chipRow, { alignItems: 'stretch' }]}>
            <Tile
              label="Members"
              value={count(stats.members.total)}
              detail={`${count(stats.members.paid)} paid · ${count(stats.members.free)} free`}
            />
            <Tile
              label="Revenue a month (estimate)"
              value={formatRent(stats.payments.estimatedMonthlyRevenue)}
              detail={`${stats.payments.monthly} monthly · ${stats.payments.passes} passes`}
            />
            <Tile
              label="Alerts"
              value={count(stats.alerts.rules)}
              detail={`${stats.alerts.accounts} accounts · ${stats.alerts.sentThisWeek} sent this week`}
            />
            <Tile label="Notification devices" value={count(stats.alerts.devices)} />
          </View>
          {stats.funnel && (
            <View style={styles.chartCard}>
              <Text accessibilityRole="header" style={styles.fieldLabel}>
                Last {stats.funnel.days} days
              </Text>
              <View style={[styles.chipRow, { alignItems: 'stretch' }]}>
                {(
                  [
                    ['Sign-ups', stats.funnel.signups],
                    ['Searches', stats.funnel.search],
                    ['Saves', stats.funnel.save],
                    ['Alerts set', stats.funnel.alert],
                    ['Checkouts started', stats.funnel.checkout],
                    ['Payments', stats.funnel.paid],
                  ] as const
                ).map(([label, value]) => (
                  <View key={label} style={{ flexGrow: 1, flexBasis: 100, gap: 2 }}>
                    <Text style={styles.smallMuted}>{label}</Text>
                    <Text style={{ fontSize: 22, fontWeight: '600', color: colors.ink }}>{count(value)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          <View style={styles.chartCard}>
            <Text accessibilityRole="header" style={styles.fieldLabel}>
              Sources and runs
            </Text>
            <Text style={styles.bodyText}>
              {stats.sources.total} sources, last checked {when(stats.sources.lastCheckedAt)}.{' '}
              {stats.sources.failed.length ? `Failing: ${stats.sources.failed.join(', ')}.` : 'None failing.'}
            </Text>
            <Text style={styles.bodyText}>Nightly resync: {run(stats.runs.nightly)}</Text>
            <Text style={styles.bodyText}>Daytime check: {run(stats.runs.daytime)}</Text>
          </View>
          <View style={styles.chartCard}>
            <Text accessibilityRole="header" style={styles.fieldLabel}>
              Public data
            </Text>
            <Text style={styles.bodyText}>
              Rent-stabilized buildings: {count(stats.data.stabilizedBuildings.count)} (loaded{' '}
              {when(stats.data.stabilizedBuildings.checkedAt)})
            </Text>
            <Text style={styles.bodyText}>
              Subway stations: {count(stats.data.subwayStations.count)} (loaded {when(stats.data.subwayStations.checkedAt)})
            </Text>
            <Text style={styles.bodyText}>Buildings with checked records: {count(stats.data.buildingsChecked)}</Text>
          </View>
        </>
      )}
    </View>
  );
}
