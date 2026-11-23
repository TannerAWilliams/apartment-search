import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { SearchFilters } from './domain.ts';
import { browserPush, deviceLabel, pushSupport, subscribePush } from './push.ts';
import { styles } from './styles.ts';
import { Button, Field } from './ui.tsx';

export type AlertState = {
  rules: { id: string; name: string; createdAt: string }[];
  devices: { label: string; createdAt: string }[];
  recent: { id: string; at: string; title: string; lines: string[] }[];
  channels: { email: boolean; push: { publicKey: string } | null };
  delivered?: { email: boolean; devices: number };
};

const WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function AlertsPage({ request, filters, summary, onError }: {
  request: (body?: unknown) => Promise<AlertState>; filters: SearchFilters; summary: string; onError: (message: string) => void;
}) {
  const [state, setState] = useState<AlertState | null>(null);
  const [name, setName] = useState(summary);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const browser = browserPush();
  const support = pushSupport(browser);

  const act = useCallback(async (label: string, body?: unknown, done?: (next: AlertState) => string) => {
    setBusy(label); setNotice('');
    try {
      const next = await request(body);
      setState(next);
      if (done) setNotice(done(next));
    } catch (error) { onError(error instanceof Error ? error.message : 'Alerts could not be updated.'); }
    finally { setBusy(''); }
  }, [request, onError]);

  useEffect(() => { void act('load'); }, [act]);

  async function turnOnNotifications() {
    if (!state?.channels.push) return;
    setBusy('device');
    try {
      const subscription = await subscribePush(state.channels.push.publicKey, browser);
      await act('device', { action: 'add-device', subscription, label: deviceLabel(browser?.userAgent ?? '') }, () => 'Notifications are on for this device.');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Notifications could not be turned on.');
      setBusy('');
    }
  }

  const pushText = !state?.channels.push ? 'Phone and browser notifications are not set up on the server.'
    : support === 'install-first' ? 'On iPhone and iPad, add this app to your Home Screen first (Share → Add to Home Screen), then open it from there and turn on notifications.'
      : support === 'blocked' ? 'Notifications are blocked for this app in your browser settings.'
        : support === 'unsupported' ? 'This browser cannot show notifications.' : null;

  return <View style={styles.marketplacePanel}>
    <View style={styles.chartIntro}>
      <Text accessibilityRole="header" style={styles.chartTitle}>Alerts</Text>
      <Text style={styles.bodyText}>Get an email or a notification when new apartments or price drops match a saved alert. Alerts are checked after you resync sources and after the daily StreetEasy upload, never on a schedule.</Text>
    </View>
    {!state ? <Text style={styles.smallMuted}>{busy === 'load' ? 'Loading alerts…' : 'Alerts are unavailable.'}</Text> : <>
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.fieldLabel}>Alert for the current search</Text>
        <Text style={styles.smallMuted}>{summary}</Text>
        <Field label="Alert name" value={name} onChangeText={setName} maxLength={60} placeholder="For example, Brooklyn 1 bedroom" />
        <Button disabled={busy !== '' || !name.trim()} onPress={() => act('rule', { action: 'add-rule', rule: { name, filters } }, () => 'Alert saved. It will report changes from now on.')}>Save alert</Button>
      </View>
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.fieldLabel}>Saved alerts ({state.rules.length})</Text>
        {state.rules.length === 0 && <Text style={styles.smallMuted}>No alerts yet.</Text>}
        {state.rules.map((rule) => <View key={rule.id} style={styles.chipRow}>
          <Text style={styles.bodyText}>{rule.name}</Text>
          <Button secondary disabled={busy !== ''} onPress={() => act('rule', { action: 'delete-rule', id: rule.id })}>{'Remove ' + rule.name}</Button>
        </View>)}
      </View>
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.fieldLabel}>Where alerts go</Text>
        <Text style={styles.bodyText}>{state.channels.email ? 'Email: to the address you sign in with.' : 'Email: not set up on the server.'}</Text>
        <Text style={styles.bodyText}>{state.devices.length ? `Notifications: ${state.devices.map(({ label }) => label).join(', ')}.` : 'Notifications: no devices yet.'}</Text>
        {pushText ? <Text style={styles.smallMuted}>{pushText}</Text>
          : <Button secondary disabled={busy !== ''} onPress={turnOnNotifications}>Turn on notifications on this device</Button>}
        <Button secondary disabled={busy !== '' || (!state.channels.email && !state.devices.length)}
          onPress={() => act('test', { action: 'test' }, (next) => next.delivered?.email || next.delivered?.devices
            ? 'Test alert sent.' : 'The test alert could not be delivered. Check the server logs.')}>Send a test alert</Button>
      </View>
      {notice !== '' && <Text accessibilityRole="alert" style={styles.bodyText}>{notice}</Text>}
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.fieldLabel}>Recent alerts</Text>
        {state.recent.length === 0 && <Text style={styles.smallMuted}>None yet.</Text>}
        {state.recent.map((alert) => <View key={alert.id}>
          <Text style={styles.bodyText}>{alert.title}</Text>
          <Text style={styles.smallMuted}>{WHEN.format(new Date(alert.at))} · {alert.lines.join(' · ')}</Text>
        </View>)}
      </View>
    </>}
  </View>;
}
