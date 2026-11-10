import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { normalizeListing } from './listings.mjs';
import { safeListingUrl } from './marketplaces.mjs';
import { REGIONS } from './regions.mjs';
import { isPoint } from './search.mjs';
import { styles } from './styles.js';
import { Button, Chip, Field } from './ui.jsx';

const STATES = { nyc: 'NY', nj: 'NJ', li: 'NY', metroNorth: 'NY', ct: 'CT', pa: 'PA' };
const BEDROOMS = ['Studio', '1 BR', '2 BR', '3 BR', '4 BR'];

export function AddListing({ initialRegion, onSave, onCancel, geocode }) {
  const [region, setRegion] = useState(initialRegion === 'all' ? 'nyc' : initialRegion);
  const [bedrooms, setBedrooms] = useState(1);
  const [fields, setFields] = useState({ url: '', address: '', unit: '', city: '', zip: '', neighborhood: '', rent: '', coordinates: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => setFields((previous) => ({ ...previous, [key]: value }));

  async function submit() {
    setError('');
    const url = safeListingUrl(fields.url.trim());
    if (!url || !/^\d{5}$/.test(fields.zip.trim()) || !/^\d+(\.\d{1,2})?$/.test(fields.rent.trim())) {
      setError('Enter a listing URL, a five-digit ZIP code, and a monthly asking rent.');
      return;
    }
    let point = {};
    if (fields.coordinates.trim()) {
      const parts = fields.coordinates.split(',').map((part) => part.trim());
      point = { latitude: Number(parts[0]), longitude: Number(parts[1]) };
      if (parts.length !== 2 || parts.some((part) => !part) || !isPoint(point)) {
        setError('Enter valid latitude, longitude coordinates.');
        return;
      }
    }

    const listing = normalizeListing({ ...fields, url, bedrooms, state: STATES[region], region,
      updatedAt: new Date().toISOString(), ...point }, { id: 'saved', name: 'Saved listing', kind: 'saved' });
    if (!listing) {
      setError('Enter the street, city or town, and a positive monthly asking rent.');
      return;
    }

    setBusy(true);
    if (!isPoint(listing) && geocode) {
      try {
        const result = await geocode([listing.address, listing.city, listing.state, listing.zip].join(', '));
        listing.latitude = result.latitude;
        listing.longitude = result.longitude;
      } catch {
        // A location lookup is optional when saving a user-provided listing.
      }
    }
    onSave(listing);
  }

  return <View style={styles.chartCard}>
    <Text accessibilityRole="header" style={styles.panelTitle}>Add a rental listing</Text>
    <Text style={styles.smallMuted}>Use the unit number to group links for the same apartment across sites.</Text>
    <Field label="Listing URL" placeholder="https://…" value={fields.url} onChangeText={set('url')} maxLength={2000} />
    <Field label="Street address" value={fields.address} onChangeText={set('address')} maxLength={140} />
    <Field label="Unit (if listed)" value={fields.unit} onChangeText={set('unit')} maxLength={45} />
    <Field label="City or borough" value={fields.city} onChangeText={set('city')} maxLength={80} />
    <Field label="ZIP code" value={fields.zip} onChangeText={set('zip')} maxLength={5} keyboardType="number-pad" />
    <Field label="Neighborhood (optional)" value={fields.neighborhood} onChangeText={set('neighborhood')} maxLength={80} />
    <Text style={styles.fieldLabel}>Region</Text>
    <View style={styles.chipRow}>{Object.keys(STATES).map((id) =>
      <Chip key={id} selected={region === id} onPress={() => setRegion(id)}>{REGIONS[id].label}</Chip>)}</View>
    <Text style={styles.fieldLabel}>Bedrooms</Text>
    <View style={styles.chipRow}>{BEDROOMS.map((label, count) =>
      <Chip key={label} selected={bedrooms === count} onPress={() => setBedrooms(count)}>{label}</Chip>)}</View>
    <Field label="Monthly asking rent ($)" value={fields.rent} onChangeText={set('rent')} maxLength={9} keyboardType="decimal-pad" />
    <Field label="Latitude, longitude (optional)" value={fields.coordinates} onChangeText={set('coordinates')} maxLength={48} />
    {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    <Button onPress={submit} disabled={busy}>{busy ? 'Saving…' : 'Save apartment'}</Button>
    <Button secondary onPress={onCancel} disabled={busy}>Cancel</Button>
  </View>;
}
