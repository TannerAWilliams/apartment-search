import { dashboardChoices, dashboardMarket, dashboardSegmentLabel, selectDashboardMetric } from './dashboard-selection.ts';
import { DashboardVisuals } from './DashboardVisuals.tsx';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { DASHBOARD_FILES, DASHBOARD_URL, METRICS, type DashboardFile } from './dashboard-data.ts';
import { Chip, Field, Link } from './ui.tsx';
import { styles } from './styles.ts';

export type DashboardResponse = {
  files?: { name: string; metric: DashboardFile['metric']; segment: string }[];
  file?: DashboardFile;
  provenance?: { downloadedAt: string };
};
export type LoadDashboard = (file: string, signal: AbortSignal) => Promise<DashboardResponse>;

export function DashboardExplorer({ loadDashboard }: { loadDashboard?: LoadDashboard }) {
  const [catalog, setCatalog] = useState<NonNullable<DashboardResponse['files']>>([]);
  const [selected, setSelected] = useState('medianAskingRent_All.csv');
  const [file, setFile] = useState<DashboardFile | null>(null);
  const [provenance, setProvenance] = useState<DashboardResponse['provenance'] | null>(null);
  const [area, setArea] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const row = file?.areas[area];
  const choices = dashboardChoices(catalog, selected);
  useEffect(() => {
    setCatalog([]);
    setProvenance(null);
    if (!loadDashboard) return;
    const controller = new AbortController();
    loadDashboard('', controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setCatalog(result.files ?? []);
          setProvenance(result.provenance ?? null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('The historical dashboard snapshot could not be loaded.');
      });
    return () => controller.abort();
  }, [loadDashboard]);
  useEffect(() => {
    setFile(null);
    setArea(0);
    setError('');
    setBusy(false);
    if (!loadDashboard) return;
    const controller = new AbortController();
    setBusy(true);
    loadDashboard(selected, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setFile(result.file ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('This historical series could not be loaded. No values have been substituted.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [selected, loadDashboard]);
  return (
    <View style={styles.chartCard}>
      <Text accessibilityRole="header" style={styles.panelTitle}>
        StreetEasy historical dashboard
      </Text>
      <Text style={styles.bodyText}>
        Historical analysis of the official monthly dashboard export. Includes all 45 CSV series, including sales and rentals, with their
        full reported history. These are market aggregates, not available apartments or individual listing histories.
      </Text>
      <Text style={styles.smallMuted}>
        Frozen historical snapshot downloaded {provenance?.downloadedAt ?? '2026-11-17'}, through October 2026. Served from the stored
        monthly export, not refreshed from StreetEasy. No personal saved apartments, notes or account data are included. Source attribution
        is retained; no automatic source refresh.
      </Text>
      <Link label="Official StreetEasy dashboard and downloads" url={DASHBOARD_URL} onError={setError} />
      {!loadDashboard && (
        <Text style={styles.smallMuted}>
          Historical dashboard data is unavailable on this server. Connect to a server with dashboard access; a private server requires
          authentication.
        </Text>
      )}
      {busy && <Text accessibilityRole="status">Reading dashboard export…</Text>}
      {error !== '' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {catalog.length > 0 && (
        <>
          <Text style={styles.fieldLabel}>
            {catalog.length} of {DASHBOARD_FILES.length} supported files in stored snapshot
          </Text>
          <Text style={styles.smallMuted}>
            Not present in snapshot: {DASHBOARD_FILES.filter((name) => !catalog.some((f) => f.name === name)).join(', ') || 'None'}. Source:
            official StreetEasy master report. Missing files are not silently filled.
          </Text>
          <Text style={styles.fieldLabel}>Market</Text>
          <View style={styles.chipRow}>
            {choices.markets.map((market) => (
              <Chip
                key={market}
                selected={choices.market === market}
                onPress={() => {
                  const next = catalog.find((item) => dashboardMarket(item.metric) === market);
                  if (next) setSelected(next.name);
                }}
              >
                {market}
              </Chip>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Metric</Text>
          <View style={styles.chipRow}>
            {choices.metrics.map((metric) => (
              <Chip
                key={metric}
                selected={choices.current?.metric === metric}
                onPress={() => {
                  const next = selectDashboardMetric(catalog, metric, choices.current?.segment);
                  if (next) setSelected(next.name);
                }}
              >
                {METRICS[metric][0]}
              </Chip>
            ))}
          </View>
          <Text style={styles.fieldLabel}>{choices.market === 'Rentals' ? 'Bedrooms' : 'Property type'}</Text>
          <View style={styles.chipRow}>
            {choices.segments.map((item) => (
              <Chip key={item.name} selected={item.name === selected} onPress={() => setSelected(item.name)}>
                {dashboardSegmentLabel(item.segment)}
              </Chip>
            ))}
          </View>
        </>
      )}
      {file && (
        <>
          <Field label="Find dashboard area" value={query} onChangeText={setQuery} maxLength={100} />
          <View style={styles.chipRow}>
            {file.areas
              .map((a, i) => ({ a, i }))
              .filter(({ a }) => `${a.name} ${a.borough}`.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 20)
              .map(({ a, i }) => (
                <Chip
                  key={i}
                  selected={i === area}
                  onPress={() => {
                    setArea(i);
                  }}
                >
                  {a.name} · {a.borough || a.type}
                </Chip>
              ))}
          </View>
          <Text style={styles.smallMuted}>
            Showing up to 20 matching areas; narrow the search for more. All/subtype and city/borough/neighborhood series overlap and must
            not be summed. Indices are repeat-listing dollar-level measures, not medians. Blank observations are unknown, not zero.
          </Text>
          {row && (
            <>
              <Text accessibilityRole="header" style={styles.fieldLabel}>
                {row.name} · {METRICS[file.metric][0]} · {file.segment}
              </Text>
              <Text style={styles.smallMuted}>
                Reported file range: {file.months[0]} to {file.months.at(-1)}. This is not a live update timestamp. Units:{' '}
                {METRICS[file.metric][1]}
                {['share', 'ratio'].includes(METRICS[file.metric][1]) ? ' (shown as percent)' : ''}.
              </Text>
              <DashboardVisuals key={file.name} file={file} areaIndex={area} />
            </>
          )}
        </>
      )}
    </View>
  );
}
