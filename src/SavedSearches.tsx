import type { SearchFilters } from './domain.ts';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, Field } from './ui.tsx';
import { styles } from './styles.ts';
import { addSavedSearch, compareWholeSnapshot, readSavedSearches, serializeSavedSearches, type SavedSearch } from './saved-searches.ts';
import { type ObservedChange } from './observed-changes.ts';
import { formatRent } from './search.ts';
const KEY = 'apartment-search:saved-searches:v1';
/** When `open` is given, the parent shows the toggle (a tool chip) and this renders only the panel. */
export function SavedSearches({
  filters,
  apply,
  check,
  disabled = false,
  open: shown,
}: {
  filters: unknown;
  apply: (filters: SearchFilters) => void;
  check: (filters: SearchFilters) => Promise<unknown>;
  disabled?: boolean;
  open?: boolean;
}) {
  const [ownOpen, setOpen] = useState(false),
    [name, setName] = useState('');
  const open = shown ?? ownOpen;
  const [searches, setSearches] = useState<SavedSearch[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''),
    [changes, setChanges] = useState<ObservedChange[]>([]);
  const locked = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        const loaded = readSavedSearches(raw);
        if (mounted.current) {
          setSearches(loaded);
          setReady(true);
        }
      })
      .catch(() => {
        if (mounted.current) setMessage('Saved searches could not be loaded. Existing data was not replaced. Reopen Search to retry.');
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  async function action(work: () => Promise<void>) {
    if (locked.current || !ready) return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    setChanges([]);
    try {
      await work();
    } catch (error) {
      if (mounted.current) setMessage((error as Error).message || 'Nothing was saved. Please retry.');
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save(next: SavedSearch[]) {
    await AsyncStorage.setItem(KEY, serializeSavedSearches(next));
    if (mounted.current) setSearches(next);
  }
  // Controlled and closed: render nothing, so the parent's spacing does not leave a gap.
  if (shown === false) return null;
  return (
    <View style={{ gap: 8 }}>
      {shown === undefined && (
        <Button secondary onPress={() => setOpen(!open)}>
          {open ? 'Hide saved searches' : 'Saved searches and whole-search checks'}
        </Button>
      )}
      {open && (
        <>
          <Text accessibilityRole="header" style={styles.fieldLabel}>
            Saved searches
          </Text>
          <Text style={styles.smallMuted}>
            Save the applied filters on this device (up to 10). Checks scan every matching apartment in cached inventory, not just this
            page. They do not refresh providers, use routing, monitor in the background or send notifications. Cached sources may be partial
            or stale; this is not all apartments on the market. Use one tab: concurrent tabs can overwrite local presets.
          </Text>
          <Field label="Saved search name" value={name} onChangeText={setName} maxLength={60} placeholder="e.g. Brooklyn under $3,000" />
          <Button
            disabled={!ready || busy || disabled}
            onPress={() =>
              action(async () => {
                const fresh = readSavedSearches(await AsyncStorage.getItem(KEY));
                await save(addSavedSearch(fresh, name, filters, Date.now().toString(36) + Math.random().toString(36).slice(2)));
                if (mounted.current) {
                  setName('');
                  setMessage('Applied search filters saved on this device.');
                }
              })
            }
          >
            Save applied search
          </Button>
          {searches.map((preset) => (
            <View key={preset.id} style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>{preset.name}</Text>
              <Text style={styles.smallMuted}>
                {preset.lastCheckedAt
                  ? `Last whole-search check: ${preset.lastCheckedAt}`
                  : 'No baseline yet. The first check establishes one.'}
              </Text>
              <View style={styles.chipRow}>
                <Button secondary disabled={busy || disabled} onPress={() => apply(preset.filters)}>
                  Apply {preset.name}
                </Button>
                <Button
                  secondary
                  disabled={busy || disabled}
                  onPress={() =>
                    action(async () => {
                      const fresh = readSavedSearches(await AsyncStorage.getItem(KEY));
                      const current = fresh.find((item) => item.id === preset.id);
                      if (!current) throw new Error('This saved search was removed in another tab. Reopen Search.');
                      const result = compareWholeSnapshot(await check(current.filters), current.baseline);
                      if (!result.snapshot.eligible) {
                        setMessage(
                          `Checked all ${result.snapshot.total} matching cached apartments, but none has usable price history. The previous baseline was kept.`,
                        );
                        return;
                      }
                      await save(
                        fresh.map((item) =>
                          item.id === current.id ? { ...item, baseline: result.baseline, lastCheckedAt: result.snapshot.checkedAt } : item,
                        ),
                      );
                      if (mounted.current) {
                        setChanges(result.changes);
                        setMessage(
                          `${current.name}: checked all ${result.snapshot.total} matching cached apartments; ${result.snapshot.eligible} have usable recorded price history. ${current.baseline ? result.changes.length + ' observed changes.' : 'Baseline saved; check again after a later source observation.'} Missing matches never mean rented or delisted.${result.baseline.truncated ? ' Older baseline records were trimmed; re-encounters may appear new.' : ''} ${result.snapshot.notices.join(' ')}`,
                        );
                      }
                    })
                  }
                >
                  Check all matches for {preset.name}
                </Button>
                <Button
                  secondary
                  disabled={busy}
                  onPress={() =>
                    action(async () => {
                      const fresh = readSavedSearches(await AsyncStorage.getItem(KEY));
                      await save(fresh.filter((item) => item.id !== preset.id));
                      if (mounted.current)
                        setMessage('Search preset and its baseline removed. Saved apartments and notes were not changed.');
                    })
                  }
                >
                  Remove {preset.name}
                </Button>
              </View>
            </View>
          ))}
          {!!message && (
            <Text accessibilityLiveRegion="polite" style={styles.smallMuted}>
              {message}
            </Text>
          )}
          {changes.slice(0, 20).map((change) => (
            <Text key={change.current.key} style={styles.bodyText}>
              {change.current.label}:{' '}
              {change.kind === 'fee_basis'
                ? 'fee basis changed; prices not directly comparable'
                : change.kind === 'newly_encountered'
                  ? 'newly encountered, not necessarily newly listed'
                  : `${formatRent(change.previous!.rent)} → ${formatRent(change.current.rent)}/mo`}{' '}
              · {change.current.sourceId} · {change.current.checkedAt}
            </Text>
          ))}
          {changes.length > 20 && <Text style={styles.smallMuted}>Showing the first 20 observed changes.</Text>}
        </>
      )}
    </View>
  );
}
