import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { listingKey } from './listings.ts';
import { comparisonOptions, comparisonRows, comparisonTitle, MAX_COMPARISON, toggleComparison } from './comparison.ts';
import { Button, Field } from './ui.tsx';
import { styles } from './styles.ts';
export function SavedComparison({ listings }: { listings: any[] }) {
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const available = useMemo(() => listings.map(listingKey), [listings]);
  useEffect(() => { setKeys(current => current.filter(key => available.includes(key))); }, [available]);
  const choices = comparisonOptions(listings, query);
  const selected = keys.map(key => listings.find(listing => listingKey(listing) === key)).filter(Boolean);
  return <View style={{ gap: 10 }}>
    <Button secondary onPress={() => setOpen(!open)}>{open ? 'Hide comparison' : 'Compare saved apartments'}</Button>
    {open && <>
      <Text accessibilityRole="header" style={styles.panelTitle}>Compare saved apartments</Text>
      <Text style={styles.smallMuted}>Choose up to four. Selection is temporary on this device. These are saved observations, not fresh availability checks. Advertised prices with different fee bases are not comparable total costs.</Text>
      <Field label="Find a saved apartment to compare" value={query} onChangeText={setQuery} placeholder="Address, unit, city or ZIP" />
      <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled accessibilityLabel="Saved apartment comparison choices">
        {choices.slice(0, 50).map(listing => {
          const key = listingKey(listing), checked = keys.includes(key), disabled = !checked && selected.length >= MAX_COMPARISON;
          return <Pressable key={key} accessibilityRole="checkbox" accessibilityLabel={'Compare ' + comparisonTitle(listing)}
            accessibilityState={{ checked, disabled }} disabled={disabled}
            onPress={() => setKeys(current => toggleComparison(current, key, available))}
            style={{ padding: 12, minHeight: 44, opacity: disabled ? 0.5 : 1 }}>
            <Text>{checked ? '☑ ' : '☐ '}{comparisonTitle(listing)}</Text>
          </Pressable>;
        })}
      </ScrollView>
      {!choices.length && <Text style={styles.smallMuted}>No saved apartments match. Save apartments from Search first.</Text>}
      {choices.length > 50 && <Text style={styles.smallMuted}>Showing the first 50 matches. Narrow your search to find another apartment.</Text>}
      <Text accessibilityLiveRegion="polite" style={styles.smallMuted}>{selected.length} of {MAX_COMPARISON} selected{selected.length === MAX_COMPARISON ? '. Remove a selection to choose another.' : ''}</Text>
      {!!selected.length && <Button secondary onPress={() => setKeys([])}>Clear comparison</Button>}
      {selected.length > 0 && <ScrollView horizontal accessibilityLabel="Apartment comparison, scroll horizontally" contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
        {selected.map(listing => <View key={listingKey(listing)} style={{ width: 260, padding: 12, borderWidth: 1, borderColor: '#aab3bf', borderRadius: 8, gap: 10 }}>
          <Text accessibilityRole="header" style={styles.fieldLabel}>{comparisonTitle(listing)}</Text>
          {comparisonRows(listing).map(([label, value]) => <View key={label} style={{ gap: 2 }}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.bodyText}>{value}</Text></View>)}
        </View>)}
      </ScrollView>}
    </>}
  </View>;
}
