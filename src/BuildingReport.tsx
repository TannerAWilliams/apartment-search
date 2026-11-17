import React from 'react';
import { Text, View } from 'react-native';
import { buildingReport } from './building-report.ts';
import { styles } from './styles.ts';
import { Link } from './ui.tsx';
export function BuildingReport({ listing, onError }) {
  const report = buildingReport(listing);
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={styles.fieldLabel}>Building due diligence</Text>
    <Text style={styles.smallMuted}>{report.scope} · {report.address}</Text>
    <Text style={styles.smallMuted}>Building identity: {report.identity}. Complaints: unknown. Violations: unknown. Bedbug history: unknown. Flood-zone check: not performed. Official record check: not performed.</Text>
    <Text style={styles.smallMuted}>{report.notice}</Text>
    {report.nyc ? <>
      <Text style={styles.smallMuted}>Review checklist: match the exact borough, address and BIN/BBL or HPD building ID; separate open from closed records; inspect recent heat/hot-water, pests and maintenance reports; check DOB permits and any vacate orders. Ask about unresolved conditions at the viewing. Records are not a substitute for inspecting the apartment.</Text>
      {report.sources.map(source => <View key={source.name} style={{ gap: 3 }}>
        <Link label={source.name} url={source.url} onError={onError} />
        <Text style={styles.smallMuted}>{source.purpose}</Text>
      </View>)}
    </> : <Text style={styles.smallMuted}>These NYC databases may not cover this address. Confirm the municipality and use its housing/building department. No NYC findings are inferred.</Text>}
  </View>;
}
