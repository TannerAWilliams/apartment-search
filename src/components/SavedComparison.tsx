import type { ListingData } from '../domain.ts';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { listingKey } from '../listings.ts';
import { comparisonOptions, comparisonRows, comparisonTitle, MAX_COMPARISON, toggleComparison } from '../comparison.ts';
import { Button, Field } from './ui.tsx';
import { colors, styles } from '../styles.ts';
/** When `open` is given, the parent shows the toggle (a tool chip) and this renders only the panel. */
export function SavedComparison({ listings, open: shown }: { listings: ListingData[]; open?: boolean }) {
  const [ownOpen, setOpen] = useState(false);
  const open = shown ?? ownOpen;
  const [keys, setKeys] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const available = useMemo(() => listings.map(listingKey), [listings]);
  useEffect(() => {
    setKeys((current) => current.filter((key) => available.includes(key)));
  }, [available]);
  const choices = comparisonOptions(listings, query);
  const selected = keys
    .map((key) => listings.find((listing) => listingKey(listing) === key))
    .filter((listing): listing is ListingData => listing !== undefined);
  // Controlled and closed: render nothing, so the parent's spacing does not leave a gap.
  if (shown === false) return null;
  return (
    <View style={{ gap: 10 }}>
      {shown === undefined && (
        <Button secondary onPress={() => setOpen(!open)}>
          {open ? 'Hide comparison' : 'Compare saved apartments'}
        </Button>
      )}
      {open && (
        <View style={styles.toolPanel}>
          <Text accessibilityRole="header" style={styles.panelTitle}>
            Compare saved apartments
          </Text>
          <Text style={styles.smallMuted}>Pick up to four to see them side by side.</Text>
          {available.length > 6 && (
            <Field
              label="Find a saved apartment to compare"
              value={query}
              onChangeText={setQuery}
              placeholder="Address, unit, city or ZIP"
            />
          )}
          <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled accessibilityLabel="Saved apartment comparison choices">
            {choices.slice(0, 50).map((listing) => {
              const key = listingKey(listing),
                checked = keys.includes(key),
                disabled = !checked && selected.length >= MAX_COMPARISON;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="checkbox"
                  accessibilityLabel={'Compare ' + comparisonTitle(listing)}
                  accessibilityState={{ checked, disabled }}
                  aria-checked={checked}
                  aria-disabled={disabled}
                  disabled={disabled}
                  onPress={() => setKeys((current) => toggleComparison(current, key, available))}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingHorizontal: 12,
                    minHeight: 44,
                    marginBottom: 6,
                    borderWidth: 1,
                    borderRadius: 10,
                    borderColor: checked ? colors.accent : colors.border,
                    backgroundColor: checked ? colors.light : 'transparent',
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      borderWidth: 2,
                      borderColor: checked ? colors.accent : colors.field,
                      backgroundColor: checked ? colors.accent : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {checked && <Text style={{ color: colors.surface, fontSize: 12, fontWeight: '700', lineHeight: 14 }}>✓</Text>}
                  </View>
                  <Text style={{ color: colors.ink, flexShrink: 1 }}>{comparisonTitle(listing)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {!choices.length && <Text style={styles.smallMuted}>No saved apartments match. Save apartments from Search first.</Text>}
          {choices.length > 50 && (
            <Text style={styles.smallMuted}>Showing the first 50 matches. Narrow your search to find another apartment.</Text>
          )}
          <Text accessibilityLiveRegion="polite" style={styles.smallMuted}>
            {selected.length} of {MAX_COMPARISON} selected
            {selected.length === MAX_COMPARISON ? '. Remove a selection to choose another.' : ''}
          </Text>
          {!!selected.length && (
            <Button secondary onPress={() => setKeys([])}>
              Clear comparison
            </Button>
          )}
          {selected.length > 0 && (
            <ScrollView
              horizontal
              accessibilityLabel="Apartment comparison, scroll horizontally"
              contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
            >
              {selected.map((listing) => (
                <View
                  key={listingKey(listing)}
                  style={{ width: 260, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, gap: 10 }}
                >
                  <Text accessibilityRole="header" style={styles.fieldLabel}>
                    {comparisonTitle(listing)}
                  </Text>
                  {comparisonRows(listing).map(([label, value]) => (
                    <View key={label} style={{ gap: 2 }}>
                      <Text style={styles.fieldLabel}>{label}</Text>
                      <Text style={styles.bodyText}>{value}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}
