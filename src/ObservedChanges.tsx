import React, { useState } from 'react';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkObservedChanges, parseChangeBaseline, type ObservedChange } from './observed-changes.ts';
import { Button } from './ui.tsx';
import { formatRent } from './search.ts';
import { styles } from './styles.ts';
const KEY = 'apartment-search:observed-changes:v1';
export function ObservedChanges({ listings }: { listings: any[] }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [changes, setChanges] = useState<ObservedChange[]>([]);
  async function check() {
    if (busy) return;
    setBusy(true); setChanges([]);
    try {
      const previous = parseChangeBaseline(await AsyncStorage.getItem(KEY));
      const result = checkObservedChanges(listings, previous);
      if (!result.eligible) { setMessage('No eligible recorded observations in this result page. Your previous check was kept.'); return; }
      await AsyncStorage.setItem(KEY, JSON.stringify(result.baseline));
      setChanges(result.changes);
      setMessage(`${previous ? `${result.changes.length} changes since your previous local check.` : 'Baseline saved. Check again after a later source observation to compare.'} Checked ${result.eligible} eligible apartments on this result page.${result.baseline.truncated ? ' Older baseline records were trimmed; a re-encountered unit may appear new to this device.' : ''}`);
    } catch { setMessage('Local change check could not be saved or read. No changes are confirmed. Try again without clearing device data.'); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    <Button secondary onPress={() => setOpen(!open)}>{open ? 'Hide local change check' : 'Local price and discovery changes'}</Button>
    {open && <>
      <Text accessibilityRole="header" style={styles.fieldLabel}>Local observed changes</Text>
      <Text style={styles.smallMuted}>Opt in by checking this result page. This stores a comparison baseline only on this device. It does not refresh sources, monitor in the background, or send notifications. Newly encountered means new to your checks, not newly listed or available. Missing results never mean delisted.</Text>
      <Button disabled={busy} onPress={check}>{busy ? 'Checking local observations…' : 'Check this page and save local baseline'}</Button>
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.smallMuted}>{message}</Text>}
      {changes.slice(0, 20).map(change => <View key={change.current.key} style={{ gap: 3 }}>
        <Text style={styles.fieldLabel}>{change.current.label}</Text>
        <Text style={styles.bodyText}>{change.kind === 'newly_encountered' ? `Newly encountered: ${formatRent(change.current.rent)}/mo` : change.kind === 'fee_basis' ? 'Reported fee basis changed. These prices are not directly comparable.' : `${change.current.rent < change.previous!.rent ? 'Observed price decrease' : 'Observed price increase'}: ${formatRent(change.previous!.rent)} → ${formatRent(change.current.rent)}/mo`}</Text>
        <Text style={styles.smallMuted}>Source: {change.current.sourceId} · observed {change.current.checkedAt} · {change.current.includesFees ? 'includes reported fees' : 'fees not confirmed'}</Text>
      </View>)}
      {changes.length > 20 && <Text style={styles.smallMuted}>Showing the first 20 changes from this check.</Text>}
    </>}
  </View>;
}
