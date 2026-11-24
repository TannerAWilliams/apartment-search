import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { SearchFilters } from '../domain.ts';
import { browserPush, deviceLabel, pushSupport, subscribePush } from '../push.ts';
import { NYC_SEARCH_AREAS } from '../regions.ts';
import { formatRent } from '../search.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Field } from '../components/ui.tsx';

/** The areas an alert can watch: all of New York City or one borough, as the search names them. */
const AREAS: [string, string, string | null][] = [
  ['nyc', 'All NYC', null],
  ['manhattan', NYC_SEARCH_AREAS.manhattan.label, 'Manhattan'],
  ['brooklyn', NYC_SEARCH_AREAS.brooklyn.label, 'Brooklyn'],
  ['queens', NYC_SEARCH_AREAS.queens.label, 'Queens'],
  ['bronx', NYC_SEARCH_AREAS.bronx.label, 'Bronx'],
  ['staten-island', NYC_SEARCH_AREAS['staten-island'].label, 'Staten Island'],
];
const BEDS: [number, string][] = [
  [0, 'Studio'],
  [1, '1 BR'],
  [2, '2 BR'],
  [3, '3 BR'],
  [4, '4+ BR'],
];
const SHOWN_NEIGHBORHOODS = 18;
type Neighborhood = { id: string; label: string; detail: string; count: number };

/** A name for an alert from what it watches: "West Village · 2 BR · under $5,000". */
export function alertName(area: string, neighborhoods: string[], beds: number[], maxRent: number | null) {
  const place = neighborhoods.length
    ? neighborhoods.length > 2
      ? `${neighborhoods[0]} + ${neighborhoods.length - 1} more`
      : neighborhoods.join(' & ')
    : (AREAS.find(([key]) => key === area)?.[1] ?? 'All NYC');
  const sorted = [...beds].sort((a, b) => a - b);
  const rooms = sorted.length
    ? sorted.map((count) => (count === 0 ? 'Studio' : String(count))).join(', ') + (sorted.some((count) => count > 0) ? ' BR' : '')
    : 'Any size';
  return [place, rooms, maxRent ? 'under ' + formatRent(maxRent) : 'any price'].join(' · ').slice(0, 60);
}

export type AlertState = {
  rules: { id: string; name: string; createdAt: string }[];
  devices: { label: string; createdAt: string }[];
  recent: { id: string; at: string; title: string; lines: string[] }[];
  channels: { email: boolean; push: { publicKey: string } | null };
  delivered?: { email: boolean; devices: number };
};

const WHEN = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function AlertsPage({
  request,
  filters,
  loadNeighborhoods,
  onError,
}: {
  request: (body?: unknown) => Promise<AlertState>;
  filters: SearchFilters;
  /** New York City's neighborhoods with listings, from the market figures. */
  loadNeighborhoods?: (signal: AbortSignal) => Promise<{ areas?: Neighborhood[] }>;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<AlertState | null>(null);
  // The new alert starts from the current search where it can.
  const [area, setArea] = useState(AREAS.some(([key]) => key === filters.region) ? filters.region : 'nyc');
  const [beds, setBeds] = useState<number[]>(filters.bedrooms == null ? [] : [Math.min(4, filters.bedrooms)]);
  const [maxRent, setMaxRent] = useState(filters.maxRent == null ? '' : String(filters.maxRent));
  const [picked, setPicked] = useState<string[]>([]);
  const [allPlaces, setAllPlaces] = useState(false);
  const [places, setPlaces] = useState<Neighborhood[]>([]);
  const [customName, setCustomName] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const browser = browserPush();
  const support = pushSupport(browser);

  const act = useCallback(
    async (label: string, body?: unknown, done?: (next: AlertState) => string) => {
      setBusy(label);
      setNotice('');
      try {
        const next = await request(body);
        setState(next);
        if (done) setNotice(done(next));
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Alerts could not be updated.');
      } finally {
        setBusy('');
      }
    },
    [request, onError],
  );

  useEffect(() => {
    void act('load');
  }, [act]);

  useEffect(() => {
    if (!loadNeighborhoods) return;
    const controller = new AbortController();
    loadNeighborhoods(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data?.areas)) setPlaces(data.areas.filter(({ id }) => id.includes('|')));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [loadNeighborhoods]);

  const borough = AREAS.find(([key]) => key === area)?.[2] ?? null;
  // The chosen borough's neighborhoods (or the city's), those with the most listings first.
  const choices = useMemo(
    () => places.filter(({ detail }) => !borough || detail === borough).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    [places, borough],
  );
  const rent = /^\d{3,6}$/.test(maxRent.trim()) ? Number(maxRent.trim()) : null;
  const rentInvalid = maxRent.trim() !== '' && rent === null;
  const name = customName.trim() || alertName(area, picked, beds, rent);
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  function saveAlert() {
    const rule = {
      name,
      filters: { region: area, maxRent: rent, bedrooms: null },
      criteria: { bedrooms: beds, neighborhoods: picked },
    };
    void act('rule', { action: 'add-rule', rule }, () => `Alert saved: ${name}. You’ll hear about new matches from now on.`);
  }

  async function turnOnNotifications() {
    if (!state?.channels.push) return;
    setBusy('device');
    try {
      const subscription = await subscribePush(state.channels.push.publicKey, browser);
      await act(
        'device',
        { action: 'add-device', subscription, label: deviceLabel(browser?.userAgent ?? '') },
        () => 'Notifications are on for this device.',
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Notifications could not be turned on.');
      setBusy('');
    }
  }

  const pushText = !state?.channels.push
    ? 'Phone and browser notifications aren’t set up yet.'
    : support === 'install-first'
      ? 'On iPhone and iPad, add this app to your Home Screen first (Share → Add to Home Screen), then open it from there and turn on notifications.'
      : support === 'blocked'
        ? 'Notifications are blocked for this app in your browser settings.'
        : support === 'unsupported'
          ? 'This browser cannot show notifications.'
          : null;

  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          Alerts
        </Text>
        <Text style={styles.bodyText}>
          Get an email when a new apartment on Walkup matches what you want, or when one drops its price. Alerts are checked after every
          resync, including the nightly one.
        </Text>
      </View>
      {!state ? (
        <Text style={styles.smallMuted}>{busy === 'load' ? 'Loading alerts…' : 'Alerts are unavailable.'}</Text>
      ) : (
        <>
          <View style={styles.chartCard}>
            <Text accessibilityRole="header" style={styles.fieldLabel}>
              New alert
            </Text>
            <Text style={styles.smallMuted}>Where</Text>
            <View style={styles.chipRow}>
              {AREAS.map(([key, label]) => (
                <Chip
                  key={key}
                  selected={area === key}
                  onPress={() => {
                    setArea(key);
                    setPicked([]);
                    setAllPlaces(false);
                  }}
                >
                  {label}
                </Chip>
              ))}
            </View>
            {choices.length > 0 && (
              <>
                <Text style={styles.smallMuted}>
                  {picked.length ? `Neighborhoods (${picked.length})` : 'Neighborhoods (optional; leave empty for the whole area)'}
                </Text>
                <View style={styles.chipRow}>
                  {(allPlaces ? choices : choices.slice(0, SHOWN_NEIGHBORHOODS)).map(({ id, label, detail }) => (
                    <Chip
                      key={id}
                      label={borough ? label : `${label}, ${detail}`}
                      selected={picked.includes(label)}
                      onPress={() =>
                        setPicked((current) => (current.includes(label) || current.length < 20 ? toggle(current, label) : current))
                      }
                    >
                      {label}
                    </Chip>
                  ))}
                  {choices.length > SHOWN_NEIGHBORHOODS && (
                    <Chip onPress={() => setAllPlaces(!allPlaces)}>{allPlaces ? 'Show fewer' : `All ${choices.length}`}</Chip>
                  )}
                </View>
              </>
            )}
            <Text style={styles.smallMuted}>Bedrooms (choose any; none means any size)</Text>
            <View style={styles.chipRow}>
              {BEDS.map(([count, label]) => (
                <Chip key={count} selected={beds.includes(count)} onPress={() => setBeds((current) => toggle(current, count))}>
                  {label}
                </Chip>
              ))}
            </View>
            <Field
              label="Max rent per month"
              value={maxRent}
              onChangeText={(text) => setMaxRent(text.replace(/[^\d]/g, ''))}
              keyboardType="number-pad"
              placeholder="Any price"
              maxLength={6}
            />
            {rentInvalid && <Text style={styles.smallMuted}>Enter a rent of at least $100, or leave it empty.</Text>}
            <Field label="Alert name" value={customName} onChangeText={setCustomName} maxLength={60} placeholder={name} />
            <Button disabled={busy !== '' || rentInvalid} onPress={saveAlert}>
              Save alert
            </Button>
          </View>
          {state.rules.length > 0 && (
            <View style={styles.chartCard}>
              <Text accessibilityRole="header" style={styles.fieldLabel}>
                Your alerts ({state.rules.length})
              </Text>
              {state.rules.map((rule) => (
                <View key={rule.id} style={styles.chipRow}>
                  <Text style={styles.bodyText}>{rule.name}</Text>
                  <Button secondary disabled={busy !== ''} onPress={() => act('rule', { action: 'delete-rule', id: rule.id })}>
                    {'Remove ' + rule.name}
                  </Button>
                </View>
              ))}
            </View>
          )}
          <View style={styles.chartCard}>
            <Text accessibilityRole="header" style={styles.fieldLabel}>
              Where alerts go
            </Text>
            <Text style={styles.bodyText}>
              {state.channels.email ? 'Email: to the address you sign in with.' : 'Email isn’t set up yet.'}
            </Text>
            {(state.channels.push || state.devices.length > 0) && (
              <Text style={styles.bodyText}>
                {state.devices.length
                  ? `Notifications: ${state.devices.map(({ label }) => label).join(', ')}.`
                  : 'Notifications: no devices yet.'}
              </Text>
            )}
            {pushText ? (
              <Text style={styles.smallMuted}>{pushText}</Text>
            ) : (
              <Button secondary disabled={busy !== ''} onPress={turnOnNotifications}>
                Turn on notifications on this device
              </Button>
            )}
            {(state.channels.email || state.devices.length > 0) && (
              <Button
                secondary
                disabled={busy !== ''}
                onPress={() =>
                  act('test', { action: 'test' }, (next) =>
                    next.delivered?.email || next.delivered?.devices
                      ? 'Test alert sent.'
                      : 'The test alert could not be delivered. Check the server logs.',
                  )
                }
              >
                Send a test alert
              </Button>
            )}
          </View>
          {notice !== '' && (
            <Text accessibilityRole="alert" style={styles.bodyText}>
              {notice}
            </Text>
          )}
          {state.recent.length > 0 && (
            <View style={styles.chartCard}>
              <Text accessibilityRole="header" style={styles.fieldLabel}>
                Recent alerts
              </Text>
              {state.recent.map((alert) => (
                <View key={alert.id}>
                  <Text style={styles.bodyText}>{alert.title}</Text>
                  <Text style={styles.smallMuted}>
                    {WHEN.format(new Date(alert.at))} · {alert.lines.join(' · ')}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}
