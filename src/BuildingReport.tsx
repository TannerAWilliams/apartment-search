import { cachedBuildingReport, buildingRequestIdentity } from './building-report-cache.ts';
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { buildingReport } from './building-report.ts';
import { styles } from './styles.ts';
import { Link } from './ui.tsx';
export function BuildingReport({ listing, onError, onCheckBuilding }) {
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const identity = buildingRequestIdentity(listing);
  useEffect(() => {
    const run = ++sequence.current;
    const controller = new AbortController();
    setResult(null); setError('');
    if (!onCheckBuilding || !buildingReport(listing).nyc) { setBusy(false); return () => controller.abort(); }
    setBusy(true);
    cachedBuildingReport(listing, onCheckBuilding, controller.signal).then(next => {
      if (run === sequence.current && !controller.signal.aborted) setResult(next);
    }).catch(() => {
      if (run === sequence.current && !controller.signal.aborted) setError('Official records could not be checked. Findings remain unknown.');
    }).finally(() => {
      if (run === sequence.current && !controller.signal.aborted) setBusy(false);
    });
    return () => { sequence.current++; controller.abort(); };
  }, [identity, onCheckBuilding]);
  const report = buildingReport(listing);
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={styles.fieldLabel}>Building due diligence</Text>
    <Text style={styles.smallMuted}>{report.scope} · {report.address}</Text>
    {!result && <Text style={styles.smallMuted}>Building identity: {report.identity}. Complaints: unknown. Violations: unknown. Bedbug history: unknown. Flood-zone check: not performed. Official record check: not performed.</Text>}
    {!result && <Text style={styles.smallMuted}>{report.notice}</Text>}
    {report.nyc && !onCheckBuilding && <Text style={styles.smallMuted}>Connect to the inventory server to retrieve official HPD records.</Text>}
    {busy && <Text accessibilityRole="status" style={styles.smallMuted}>Loading official building records automatically…</Text>}
    <Text style={styles.smallMuted}>Reports load when details open. Completed reports may be reused for five minutes in this session; partial or unknown reports for 30 seconds. Close and reopen after that to check again.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.smallMuted}>{error}</Text> : null}
    {result && <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>Official building report: {result.status}</Text>
      <Text style={styles.smallMuted}>Retrieved {result.checkedAt}. Retrieval time is not the source update time.</Text>
      <Text style={styles.smallMuted}>{result.identity ? `Exact active HPD building match: ${result.identity.address} · ${result.identity.borough} · building ID ${result.identity.buildingId}${result.identity.bin ? ' · BIN ' + result.identity.bin : ''}` : 'Building identity unmatched. No building findings inferred.'}</Text>
      <Text style={styles.smallMuted}>Open HPD violations in dataset: {result.openViolations ?? 'unknown'}. Distinct complaints received since {result.since ?? 'unknown date'} (365 NYC calendar days including today): {result.complaintsLast365Days ?? 'unknown'}.</Text>
      <Text style={styles.smallMuted}>Complaint counts include open and closed reports, not confirmed violations. Counts may lag current conditions and do not prove safety, habitability or an absence of problems. This is building-wide, not apartment-specific. Flood-map coverage not shown here remains unknown; consult the official sources below.</Text>
      <Text style={styles.smallMuted}>{result.bedbugs ? `Latest owner-filed bedbug report: ${result.bedbugs.periodStart} to ${result.bedbugs.periodEnd}, filed ${result.bedbugs.filedAt}. Units reported: ${result.bedbugs.units}; infested ${result.bedbugs.infested}; eradicated ${result.bedbugs.eradicated}; reinfested ${result.bedbugs.reinfested}. This is an owner filing, not an independent inspection or a statement of current infestation. Corrections use the latest filing, never summed.` : 'Bedbug annual filing: unknown / no unambiguous report retrieved.'}</Text>
      <Text style={styles.fieldLabel}>DOB records by matched BIN</Text>
      {result.dob ? result.dob.map(source => <View key={source.dataset} style={{ gap: 2 }}>
        <Link label={source.label} url={`https://data.cityofnewyork.us/d/${source.dataset}`} onError={onError} />
        <Text style={styles.smallMuted}>{source.groups === null ? 'Unknown / source unavailable' : source.groups.length ? source.groups.map(group => `${group.status}: ${group.count}`).join(' · ') : 'No records returned from this dataset.'}</Text>
      </View>) : <Text style={styles.smallMuted}>Unknown: a valid exact building BIN is unavailable.</Text>}
      <Text style={styles.smallMuted}>BIS, DOB NOW Safety and ECB are separate datasets. Counts include their reported categories/statuses and can overlap; they are not added together or represented as all active violations. No records does not mean no DOB issues. Other DOB filings and inspections are outside this summary.</Text>
      <Text style={styles.fieldLabel}>Preliminary flood-map screening</Text>
      <Text style={styles.smallMuted}>{result.flood ? `${result.flood.layer}: ${result.flood.intersects ? 'special flood hazard area returned at this point' : 'no special flood hazard area returned at this point'}. Mapped zone labels: ${result.flood.zones.join(', ') || 'none'}. Checked at the matched building point in the official HPD bedbug dataset (${result.flood.point.latitude}, ${result.flood.point.longitude}), not the listing/neighborhood coordinates.` : 'Unknown: no usable matched official building point or map response.'}</Text>
      <Text style={styles.smallMuted}>This is the 2015 preliminary coastal 100-year layer, not effective FEMA insurance mapping, all flood scenarios, current/future risk or the entire building footprint. A point outside it does not mean flood-safe. Stormwater and unit/floor exposure are not assessed.</Text>
      <Link label="Official NYC preliminary flood layer" url="https://a841-dotweb01.nyc.gov/arcgis/rest/services/Climate_Resiliency/Climate_Resiliency/MapServer/7" onError={onError} />
      {(result.errors ?? []).map((message, index) => <Text key={index} style={styles.smallMuted}>{message}</Text>)}
    </View>}
    {report.nyc ? <>
      <Text style={styles.smallMuted}>Review checklist: match the exact borough, address and BIN/BBL or HPD building ID; separate open from closed records; inspect recent heat/hot-water, pests and maintenance reports; check DOB permits and any vacate orders. Ask about unresolved conditions at the viewing. Records are not a substitute for inspecting the apartment.</Text>
      {report.sources.map(source => <View key={source.name} style={{ gap: 3 }}>
        <Link label={source.name} url={source.url} onError={onError} />
        <Text style={styles.smallMuted}>{source.purpose}</Text>
      </View>)}
    </> : <Text style={styles.smallMuted}>These NYC databases may not cover this address. Confirm the municipality and use its housing/building department. No NYC findings are inferred.</Text>}
  </View>;
}
