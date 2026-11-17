import type { ListingData } from './domain.ts';
import React, { useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { IMPORT_COLUMNS, MAX_IMPORT_SIZE, parseListingImport } from './import-listings.ts';
import { styles } from './styles.ts';
import { Button } from './ui.tsx';

export function ImportListings({ onImport, onCancel }: { onImport: (listings: ListingData[]) => void; onCancel: () => void }) {
  const [csv, setCsv] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);

  async function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setCsv('');
    if (file.size > MAX_IMPORT_SIZE) {
      setError('Choose a CSV under 256 KB.');
      return;
    }
    setReading(true);
    try {
      setCsv(await file.text());
    } catch {
      setError('This file could not be read.');
    } finally {
      setReading(false);
    }
  }

  function submit() {
    setError('');
    try {
      onImport(parseListingImport(csv));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The CSV could not be imported.');
    }
  }

  return <View style={styles.chartCard}>
    <Text accessibilityRole="header" style={styles.panelTitle}>Import rental listings</Text>
    <Text style={styles.bodyText}>Upload or paste a CSV of listings you’ve collected, including their direct links. They’ll appear in Saved on this device.</Text>
    <Text selectable style={styles.fieldLabel}>{IMPORT_COLUMNS}</Text>
    <Text style={styles.smallMuted}>Use 0 for a studio. Add latitude and longitude columns if you want map pins. Enter up to 500 apartments per import.</Text>
    {Platform.OS === 'web' && <input type="file" accept=".csv,text/csv" aria-label="Upload listing CSV"
      onChange={selectFile} disabled={reading} />}
    <TextInput accessibilityLabel="Listing CSV" value={csv} onChangeText={setCsv}
      multiline numberOfLines={5} maxLength={MAX_IMPORT_SIZE}
      autoCapitalize="none" autoCorrect={false} style={[styles.input, { minHeight: 105, textAlignVertical: 'top' }]} />
    {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <View style={styles.chipRow}>
      <Button onPress={submit} disabled={!csv.trim() || reading}>Save listings</Button>
      <Button secondary onPress={onCancel}>Cancel</Button>
    </View>
  </View>;
}
