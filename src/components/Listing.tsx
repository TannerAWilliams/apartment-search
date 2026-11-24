import type { ListingData, SourceLink, Workplace } from '../domain.ts';
import { typicalCosts } from '../move-in.ts';
import { buildingGrade, marketBadge, type BuildingFacts } from '../insights.ts';
import type { CheckBuilding } from './BuildingReport.tsx';
import { BuildingReport } from './BuildingReport.tsx';
import { discoveryFacts, LAUNDRY_LABELS } from '../discovery.ts';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { matchesRegion, REGIONS, searchBorough } from '../regions.ts';
import { directionsLink, formatRent } from '../search.ts';
import { listingLinkLabel, listingPresentation, orderedListingLinks } from '../listings.ts';
import { colors, styles } from '../styles.ts';
import { Disclosure, Link } from './ui.tsx';
import { ListingSources } from './ListingSources.tsx';
import { CommuteDetails } from './CommuteDetails.tsx';
import { PriceHistory } from './PriceHistory.tsx';
import { SavedNotes } from './SavedNotes.tsx';
import { listingKey } from '../listings.ts';
import { HousingCost } from './HousingCost.tsx';
import { HeartIcon } from './Icons.tsx';
import { ListingThumbnail } from './ListingThumbnail.tsx';

const CHECK_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});
/** About what the apartment costs each month and to move in, from typical amounts and the state's rules. */
function TypicalCost({ listing }: { listing: ListingData }) {
  if (!(listing.rent > 0)) return null;
  const cost = typicalCosts(listing);
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>
        About {formatRent(cost.monthly)} a month all in · {formatRent(cost.moveIn + cost.possibleBrokerFee)} to move in
      </Text>
      <Text style={styles.smallMuted}>
        Monthly: rent {formatRent(cost.parts.rent)}, electricity and gas about {formatRent(cost.parts.utilities)}, internet{' '}
        {formatRent(cost.parts.internet)}, renter’s insurance {formatRent(cost.parts.insurance)}. Move-in: first month, a{' '}
        {formatRent(cost.moveInParts.deposit)} deposit and a {formatRent(cost.moveInParts.applicationFee)} application fee
        {cost.possibleBrokerFee ? `, and possibly a ${formatRent(cost.possibleBrokerFee)} broker fee` : ''}.
      </Text>
      {cost.notes.map((note) => (
        <Text key={note} style={styles.smallMuted}>
          {note}
        </Text>
      ))}
    </View>
  );
}

/** A building's grade and the records behind it, as of its last check. */
function BuildingSummary({ facts }: { facts: BuildingFacts }) {
  const grade = buildingGrade(facts);
  const known = (value: number | boolean | null, text: string) => (value === null ? null : text);
  const lines = [
    facts.stabilized === null
      ? null
      : facts.stabilized
        ? 'Registers rent-stabilized units with the state'
        : 'No rent-stabilized units registered',
    known(facts.openViolations, `${facts.openViolations} open HPD violations`),
    known(facts.complaints, `${facts.complaints} complaints in the last year`),
    known(facts.bedbugs, facts.bedbugs ? 'Bedbugs reported in its last filing' : 'No bedbugs in its last filing'),
    known(facts.flood, facts.flood ? 'In the 100-year flood zone' : 'Outside the 100-year flood zone'),
  ].filter(Boolean);
  return (
    <Text style={styles.smallMuted}>
      {grade ? `Building grade ${grade}: ` : 'Building: '}
      {lines.join(' · ') || 'no city record found'} (checked {new Date(facts.checkedAt).toLocaleDateString('en-US')}).
    </Text>
  );
}

const card = StyleSheet.create({
  media: { height: 190, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.light },
  tags: { position: 'absolute', top: 12, left: 12, right: 64, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.ink,
    backgroundColor: '#ffffffee',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  // The heart sits on the image: white outline over a darkened fill, no circle behind it.
  heart: { position: 'absolute', top: 10, right: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.ink },
  subtitle: { fontSize: 15, lineHeight: 20, color: colors.muted },
  priceLine: { fontSize: 15, lineHeight: 20, color: colors.ink, marginTop: 4 },
  notice: { fontSize: 13, lineHeight: 18, color: '#805213' },
  details: { borderTopWidth: 1, borderColor: '#ebebeb', paddingTop: 12, gap: 8 },
});

export function Listing({
  listing,
  selectedSource,
  workplace,
  commute,
  onSave,
  onSaveLink,
  onRemove,
  onError,
  saved,
  onCheckBuilding,
}: {
  listing: ListingData;
  selectedSource?: string;
  workplace: Workplace;
  commute?: boolean;
  onSave: (listing: ListingData) => void;
  onSaveLink: (listing: ListingData, link: SourceLink) => void;
  onRemove?: (listing: ListingData) => void;
  onError: (message: string) => void;
  saved: boolean;
  onCheckBuilding?: CheckBuilding;
}) {
  const [expanded, setExpanded] = useState(false);
  const { region, address, unit, city, state, zip, rent, transitSeconds, drivingSeconds, neighborhood } = listing;
  const regionKey =
    searchBorough(listing) ?? (region === 'metroNorth' && matchesRegion(listing, 'westchester') ? 'westchester' : region) ?? 'all';
  const regionInfo = Object.hasOwn(REGIONS, regionKey) ? REGIONS[regionKey as keyof typeof REGIONS] : undefined;
  const title = unit ? `${address}, ${unit.startsWith('#') ? unit : 'Unit ' + unit}` : address;
  const subtitle = [neighborhood === city ? '' : neighborhood, `${city}, ${state} ${zip}`].filter(Boolean).join(' · ');
  const [original] = orderedListingLinks(listing.sources, selectedSource);
  const presentation = listingPresentation(listing);
  const grade = buildingGrade(listing.building);
  const badge = marketBadge(listing.insights);
  const facts = discoveryFacts(listing);
  // Only what the listing says; unknown details are simply not listed.
  const knownFacts = [
    facts.bathrooms === null ? '' : `${facts.bathrooms} baths`,
    facts.squareFeet === null ? '' : `${facts.squareFeet.toLocaleString('en-US')} sq ft`,
    facts.petsAllowed === null ? '' : facts.petsAllowed ? 'Pets allowed; verify restrictions' : 'Pets not allowed per source',
    facts.laundry === null ? '' : LAUNDRY_LABELS[facts.laundry],
  ].filter(Boolean);
  const checkedAt = listing.checkedAt ?? listing.seenAt;
  const checked = Number.isFinite(Date.parse(checkedAt ?? ''))
    ? 'Checked ' + CHECK_TIME.format(new Date(checkedAt ?? ''))
    : 'Check date unavailable';
  return (
    <View style={styles.rentalCard}>
      {/* The card itself opens its details, as listing cards do in travel-booking apps; the heart saves. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={'Details for ' + title}
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={() => setExpanded(!expanded)}
        style={({ pressed }) => [{ gap: 10 }, pressed && { opacity: 0.85 }]}
      >
        <View style={card.media}>
          <ListingThumbnail latitude={listing.latitude} longitude={listing.longitude} />
          <View style={card.tags}>
            <Text style={card.tag}>{presentation.bedsLabel}</Text>
            {commute && transitSeconds != null && <Text style={card.tag}>{Math.ceil(transitSeconds / 60)} min transit</Text>}
            {commute && drivingSeconds != null && <Text style={card.tag}>{Math.ceil(drivingSeconds / 60)} min drive</Text>}
            {listing.building?.stabilized && <Text style={card.tag}>Rent-stabilized building</Text>}
            {grade && <Text style={card.tag}>Building {grade}</Text>}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={onRemove ? 'Remove saved apartment' : saved ? 'Apartment saved' : 'Save apartment'}
            accessibilityState={{ disabled: !onRemove && saved }}
            disabled={!onRemove && saved}
            onPress={() => (onRemove ? onRemove(listing) : onSave(listing))}
            hitSlop={8}
            style={card.heart}
          >
            <HeartIcon
              size={26}
              color={saved || onRemove ? colors.green : colors.white}
              filled={saved || Boolean(onRemove)}
              fill="#00000066"
            />
          </Pressable>
        </View>
        <View style={{ gap: 2 }}>
          <Text accessibilityRole="header" style={card.title}>
            {title}
          </Text>
          <Text style={card.subtitle}>{[subtitle, regionInfo?.label].filter(Boolean).join(' · ')}</Text>
          <Text style={card.priceLine}>
            <Text style={styles.price}>{presentation.priceKnown ? formatRent(rent) : 'Price unavailable'}</Text>
            {presentation.priceKnown && ' month'}
            {(listing.kind === 'snapshot' || listing.priceIncludesFees) &&
              (listing.kind === 'snapshot' ? ' · Recorded rent' : ' · Total price, fees included')}
          </Text>
          {badge && (
            <Text style={[card.subtitle, listing.insights!.vsMarket! < 0 && { color: colors.ink, fontWeight: '600' }]}>
              {badge} · median {formatRent(listing.insights!.marketMedian!)} for {listing.insights!.comparedWith} nearby
            </Text>
          )}
        </View>
      </Pressable>
      <View style={styles.rentalCardBody}>
        {listing.bestFit && (
          <View style={{ gap: 3 }}>
            <Text style={styles.fieldLabel}>
              Best fit {listing.bestFit.score}/100 ·{' '}
              {listing.bestFit.rentWeight
                ? `rent savings ${listing.bestFit.affordability}/${listing.bestFit.rentWeight}`
                : 'rent not weighted'}{' '}
              ·{' '}
              {listing.bestFit.commuteWeight
                ? `commute ${listing.bestFit.commute}/${listing.bestFit.commuteWeight}`
                : 'commute not weighted'}
            </Text>
            <Text style={styles.smallMuted}>{listing.bestFit.explanation}</Text>
            <Text style={styles.smallMuted}>
              Uses asking/recorded rent, not total move-in cost. Uses a matching TravelTime weekday-morning estimate when available, not
              live traffic or straight-line distance. No building safety or quality score. {listing.bestFit.unknowns.join(' · ')}{' '}
              {listing.bestFit.checkedAt ? 'Commute estimate checked ' + CHECK_TIME.format(new Date(listing.bestFit.checkedAt)) : ''}
            </Text>
          </View>
        )}
        {(listing.insights?.warnings ?? []).map((warning) => (
          <Text key={warning} accessibilityRole="alert" style={card.notice}>
            ⚠ {warning}
          </Text>
        ))}
        {presentation.notices.map((notice) => (
          <Text key={notice} style={card.notice}>
            {notice}
          </Text>
        ))}
        {expanded && (
          <View style={card.details}>
            {original?.url ? <Link label={listingLinkLabel(original)} url={original.url} onError={onError} /> : null}
            <Text style={styles.smallMuted}>
              {checked}
              {['snapshot', 'cached'].includes(listing.kind) ? ' · Previously saved data' : ''}
            </Text>
            {listing.company ? (
              <Text style={styles.smallMuted}>
                {listing.companyFromSnapshot || listing.kind === 'snapshot' ? 'Snapshot advertiser' : 'Listed by'} {listing.company}
              </Text>
            ) : null}
            <View style={styles.cardLinks}>
              <Link label="Transit directions" url={directionsLink(listing, workplace)} onError={onError} />
              <Link label="Driving directions" url={directionsLink(listing, workplace, 'driving')} onError={onError} />
            </View>
            <ListingSources listing={listing} onSaveLink={onSaveLink} onError={onError} />
            {saved && <SavedNotes key={listingKey(listing)} identity={listingKey(listing)} />}
            {knownFacts.length > 0 && <Text style={styles.smallMuted}>Source-reported details: {knownFacts.join(' · ')}</Text>}
            {listing.building && <BuildingSummary facts={listing.building} />}
            <CommuteDetails listing={listing} />
            <PriceHistory value={listing.priceHistory} />
            <TypicalCost listing={listing} />
            <Disclosure title="Estimate the full cost of renting">
              <HousingCost />
            </Disclosure>
            {/* NYC's building records cover the five boroughs only; elsewhere there is nothing to check. */}
            <Pressable accessibilityRole="button" onPress={() => setExpanded(false)} style={{ paddingVertical: 8 }}>
              <Text style={styles.linkText}>Hide details</Text>
            </Pressable>
            {searchBorough(listing) && (
              // The report loads when opened: violations, ownership and rent stabilization from NYC's records.
              <Disclosure title="NYC building records">
                <BuildingReport key={listingKey(listing)} listing={listing} onError={onError} onCheckBuilding={onCheckBuilding} />
              </Disclosure>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
