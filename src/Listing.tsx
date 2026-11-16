import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { REGIONS, searchBorough } from './regions.ts';
import { directionsLink, formatRent } from './search.ts';
import { listingLinkLabel, listingPresentation, orderedListingLinks } from './listings.ts';
import { colors, styles } from './styles.ts';
import { ExternalLink, Link } from './ui.tsx';
import { ListingSources } from './ListingSources.tsx';
import { HousingCost } from './HousingCost.tsx';

const CHECK_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const card = StyleSheet.create({
  headline: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  primary: { flex: 1, minWidth: 0, gap: 3 },
  action: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 10, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  notice: { fontSize: 13, lineHeight: 18, color: '#805213' },
  details: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, gap: 8 },
});

export function Listing({ listing, selectedSource, workplace, commute, onSave, onSaveLink, onRemove, onError, saved }) {
  const [expanded, setExpanded] = useState(false);
  const { region, address, unit, city, state, zip, rent, transitSeconds, drivingSeconds, neighborhood } = listing;
  const regionInfo = REGIONS[searchBorough(listing) ?? region];
  const title = unit ? `${address}, ${unit.startsWith('#') ? unit : 'Unit ' + unit}` : address;
  const subtitle = [neighborhood === city ? '' : neighborhood, `${city}, ${state} ${zip}`].filter(Boolean).join(' · ');
  const [original] = orderedListingLinks(listing.sources, selectedSource);
  const presentation = listingPresentation(listing);
  const checkedAt = listing.checkedAt ?? listing.seenAt;
  const checked = Number.isFinite(Date.parse(checkedAt)) ? 'Checked ' + CHECK_TIME.format(new Date(checkedAt)) : 'Check date unavailable';
  return <View style={styles.rentalCard}>
    <View style={styles.rentalCardBody}>
      <View style={card.headline}>
        <View style={card.primary}>
          <Text style={styles.price}>{presentation.priceKnown ? formatRent(rent) : 'Price unavailable'}</Text>
          <Text style={styles.smallMuted}>{listing.kind === 'snapshot' ? 'recorded rent / mo' : listing.priceIncludesFees ? 'total price / mo' : 'asking rent / mo'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={onRemove ? 'Remove saved apartment' : saved ? 'Apartment saved' : 'Save apartment'}
          accessibilityState={{ disabled: !onRemove && saved }} disabled={!onRemove && saved}
          onPress={() => onRemove ? onRemove(listing) : onSave(listing)} style={card.action}>
          <Text style={styles.linkText}>{onRemove ? '♥ Remove' : saved ? '♥ Saved' : '♡ Save'}</Text>
        </Pressable>
      </View>
      <View style={styles.cardStats}>
        <Text style={styles.cardStat}>{presentation.bedsLabel}</Text>
        {regionInfo && <Text style={styles.smallMuted}>{regionInfo.label}</Text>}
        {commute && <>
          <Text style={styles.cardStat}>{transitSeconds == null ? 'Transit unavailable' : `${Math.ceil(transitSeconds / 60)} min transit`}</Text>
          <Text style={styles.cardStat}>{drivingSeconds == null ? 'Driving unavailable' : `${Math.ceil(drivingSeconds / 60)} min drive`}</Text>
        </>}
      </View>
      {original?.url ? <ExternalLink url={original.url} onError={onError} accessibilityLabel={title + ' on ' + original.name}>
        <Text style={styles.listingAddress}>{title}</Text>
      </ExternalLink> : <Text accessibilityRole="header" style={styles.listingTitle}>{title}</Text>}
      <Text style={styles.smallMuted}>{subtitle}</Text>
      {presentation.notices.map(notice => <Text key={notice} style={card.notice}>{notice}</Text>)}
      <View style={card.actions}>
        {original?.url && <Link label={listingLinkLabel(original)} url={original.url} onError={onError} />}
        <Pressable accessibilityRole="button" accessibilityLabel={'Details for ' + title} accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)} style={card.action}>
          <Text style={styles.linkText}>{expanded ? 'Hide details' : 'Details'}</Text>
        </Pressable>
      </View>
      {expanded && <View style={card.details}>
        <Text style={styles.smallMuted}>{checked}{['snapshot', 'cached'].includes(listing.kind) ? ' · Previously saved data' : ''}</Text>
        {listing.company ? <Text style={styles.smallMuted}>{listing.companyFromSnapshot || listing.kind === 'snapshot' ? 'Snapshot advertiser' : 'Listed by'} {listing.company}</Text> : null}
        <View style={styles.cardLinks}>
          <Link label="Transit directions" url={directionsLink(listing, workplace)} onError={onError} />
          <Link label="Driving directions" url={directionsLink(listing, workplace, 'driving')} onError={onError} />
        </View>
        <ListingSources listing={listing} onSaveLink={onSaveLink} onError={onError} />
        <HousingCost />
      </View>}
    </View>
  </View>;
}

