import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { listingLinkLabel, orderedListingLinks, sourceLink } from './listings.ts';
import { marketplaceAddressSearches } from './marketplaces.ts';
import { styles } from './styles.ts';
import { Button, Field, Link } from './ui.tsx';

export function ListingSources({ listing, onSaveLink, onError }) {
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const direct = orderedListingLinks(listing.sources);
  const count = new Set(direct.map(({ id }) => id)).size;

  function save() {
    const link = sourceLink(url.trim(), 'saved');
    if (!link) {
      setError('Paste a full HTTPS listing link.');
      return;
    }
    onSaveLink(listing, link);
    setUrl('');
    setError('');
  }

  return <View style={styles.listingWebsites}>
    <Button secondary onPress={() => setExpanded(!expanded)}>
      {`Listing websites (${count}) ${expanded ? '↑' : '↓'}`}
    </Button>
    {expanded && <>
      {direct.length > 0 && <View style={styles.sourceGroup}>
        <Text style={styles.fieldLabel}>Direct links for this listing</Text>
        <View style={styles.actionLinks}>
          {direct.map((link) => <Link key={link.url} label={listingLinkLabel(link)}
            url={link.url} onError={onError} />)}
        </View>
      </View>}
      {listing.buildingLinks?.length > 0 && <View style={styles.sourceGroup}>
        <Text style={styles.fieldLabel}>Housing lotteries at this building</Text>
        {listing.buildingLinks.map(({ name, url }) =>
          <Link key={url} label={name} url={url} onError={onError} />)}
      </View>}
      <View style={styles.sourceGroup}>
        <Text style={styles.fieldLabel}>Search for this address on other sites</Text>
        <Text style={styles.smallMuted}>These links open Google results. Look for the matching apartment number.</Text>
        <View style={styles.addressLinks}>
          {marketplaceAddressSearches(listing, direct.filter(({ kind }) => kind !== 'snapshot' && kind !== 'cached')).map((link) =>
            <Link key={link.id} label={`Search ${link.name}`} url={link.url} onError={onError} />)}
        </View>
      </View>
      <Field label="Add a link for this unit" placeholder="Paste a listing URL" value={url} onChangeText={setUrl} maxLength={2000} />
      {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Button secondary onPress={save} disabled={!url.trim()}>Save link</Button>
    </>}
  </View>;
}
