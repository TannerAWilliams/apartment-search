import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { buildingReport } from './building-report.ts';
import { styles } from './styles.ts';
import { Button, Link } from './ui.tsx';
export function BuildingReport({ listing, onError, onCheckBuilding }) {
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const active = useRef(false);
  const identity = JSON.stringify([listing.address, listing.city, listing.county, listing.state, listing.zip]);
  useEffect(() => { sequence.current++; active.current = false; setResult(null); setError(''); setBusy(false); return () => { sequence.current++; }; }, [identity]);
  async function check() {
    if (active.current || !onCheckBuilding) return;
    active.current = true;
    const run = ++sequence.current; setBusy(true); setError('');
    try { const next = await onCheckBuilding(listing); if (run === sequence.current) setResult(next); }
    catch { if (run === sequence.current) { setResult(null); setError('Official records could not be checked. Findings remain unknown.'); } }
    finally { if (run === sequence.current) { active.current = false; setBusy(false); } }
  }
  const report = buildingReport(listing);
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={styles.fieldLabel}>Building due diligence</Text>
    <Text style={styles.smallMuted}>{report.scope} · {report.address}</Text>
    {!result && <Text style={styles.smallMuted}>Building identity: {report.identity}. Complaints: unknown. Violations: unknown. Bedbug history: unknown. Flood-zone check: not performed. Official record check: not performed.</Text>}
    {!result && <Text style={styles.smallMuted}>{report.notice}</Text>}
    {report.nyc && !onCheckBuilding && <Text style={styles.smallMuted}>Connect to the inventory server to retrieve official HPD records.</Text>}
    {report.nyc && onCheckBuilding && <Button secondary disabled={busy} onPress={check}>{busy ? 'Checking official HPD records…' : 'Check official HPD records'}</Button>}
    {error ? <Text accessibilityRole="alert" style={styles.smallMuted}>{error}</Text> : null}
    {result && <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>HPD lookup: {result.status}</Text>
      <Text style={styles.smallMuted}>Retrieved {result.checkedAt}. Retrieval time is not the source update time.</Text>
      <Text style={styles.smallMuted}>{result.identity ? `Exact active HPD building match: ${result.identity.address} · ${result.identity.borough} · building ID ${result.identity.buildingId}${result.identity.bin ? ' · BIN ' + result.identity.bin : ''}` : 'Building identity unmatched. No building findings inferred.'}</Text>
      <Text style={styles.smallMuted}>Open HPD violations in dataset: {result.openViolations ?? 'unknown'}. Distinct complaints received since {result.since ?? 'unknown date'} (365 NYC calendar days including today): {result.complaintsLast365Days ?? 'unknown'}.</Text>
      <Text style={styles.smallMuted}>Complaint counts include open and closed reports, not confirmed violations. Counts may lag current conditions and do not prove safety, habitability or an absence of problems. This is building-wide, not apartment-specific. Bedbug history, DOB records and flood maps still require manual review below.</Text>
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
