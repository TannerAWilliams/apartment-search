import type { ListingData, SourceLink, Workplace } from '../domain.ts';
import { typicalCosts } from '../move-in.ts';
import { buildingGrade, listedLabel, marketBadge, type BuildingFacts } from '../insights.ts';
import type { CheckBuilding } from './BuildingReport.tsx';
import { BuildingReport } from './BuildingReport.tsx';
import { discoveryFacts, LAUNDRY_LABELS } from '../discovery.ts';
import type React from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { matchesRegion, REGIONS, searchBorough } from '../regions.ts';
import { directionsLink, formatRent } from '../search.ts';
import { listingLinkLabel, listingPresentation, orderedListingLinks } from '../listings.ts';
import { colors, styles } from '../styles.ts';
import { Disclosure, ExternalLink, Link } from './ui.tsx';
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
  const row = (label: string, amount: number, total = false) => (
    <View key={label} style={[card.costRow, total && card.costTotal]}>
      <Text style={total ? card.highlight : styles.bodyText}>{label}</Text>
      <Text style={total ? card.highlight : styles.bodyText}>{formatRent(amount)}</Text>
    </View>
  );
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>Each month</Text>
      {row('Rent', cost.parts.rent)}
      {row('Electricity and gas (typical)', cost.parts.utilities)}
      {row('Internet', cost.parts.internet)}
      {row('Renter’s insurance', cost.parts.insurance)}
      {row('About, all in', cost.monthly, true)}
      <Text style={[styles.fieldLabel, { marginTop: 8 }]}>To move in</Text>
      {row('First month', cost.moveInParts.firstMonth)}
      {row('Security deposit', cost.moveInParts.deposit)}
      {row('Application fee', cost.moveInParts.applicationFee)}
      {cost.possibleBrokerFee ? row('Broker fee, if you pay one', cost.possibleBrokerFee) : null}
      {row('Total', cost.moveIn + cost.possibleBrokerFee, true)}
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

/** A part of the details with a divider and a heading, as listing pages separate theirs. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16, marginTop: 4 }}>
      <Text accessibilityRole="header" style={{ fontSize: 18, lineHeight: 24, fontWeight: '600', color: colors.ink }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const card = StyleSheet.create({
  // Photos a little wider than tall, with rounded corners, as listing apps show them.
  media: { width: '100%', aspectRatio: 4 / 3, maxHeight: 320, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.light },
  tags: { position: 'absolute', top: 12, left: 12, right: 64, flexDirection: 'row' },
  tag: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.ink,
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  // The heart sits on the image: white outline over a darkened fill, no circle behind it.
  heart: { position: 'absolute', top: 10, right: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.ink },
  grade: { fontSize: 14, lineHeight: 20, color: colors.ink },
  subtitle: { fontSize: 15, lineHeight: 20, color: colors.muted },
  priceLine: { fontSize: 15, lineHeight: 20, color: colors.ink, marginTop: 4 },
  notice: { fontSize: 13, lineHeight: 18, color: '#805213' },
  details: { paddingTop: 4, gap: 12 },
  highlight: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.ink },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  costTotal: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 2 },
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
  const { region, address, unit, city, rent, transitSeconds, drivingSeconds, neighborhood } = listing;
  const regionKey =
    searchBorough(listing) ?? (region === 'metroNorth' && matchesRegion(listing, 'westchester') ? 'westchester' : region) ?? 'all';
  const regionInfo = Object.hasOwn(REGIONS, regionKey) ? REGIONS[regionKey as keyof typeof REGIONS] : undefined;
  const title = unit ? `${address}, ${unit.startsWith('#') ? unit : 'Unit ' + unit}` : address;
  const [original] = orderedListingLinks(listing.sources, selectedSource);
  const presentation = listingPresentation(listing);
  const grade = buildingGrade(listing.building);
  const badge = marketBadge(listing.insights);
  const nearest = listing.insights?.subway?.[0];
  const listed = listedLabel(listing.insights?.firstSeen);
  const isNew = listed?.startsWith('New') ?? false;
  const priceCut = listing.insights?.priceCut;
  const photoBadge = isNew
    ? listed
    : priceCut
      ? `Price cut ${formatRent(priceCut)}`
      : listing.building?.stabilized
        ? 'Rent-stabilized'
        : null;
  const longListed = !isNew && listed && Date.now() - Date.parse(listing.insights!.firstSeen!) >= 21 * 86_400_000;
  // Where, then what: the place and the nearest train; then size, and what the badge did not already say.
  const place = [
    neighborhood && neighborhood !== city ? `${neighborhood}, ${city}` : (regionInfo?.label ?? city),
    nearest ? `${nearest.minutes} min to ${nearest.routes.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const details = [
    presentation.bedsLabel,
    commute && transitSeconds != null ? `${Math.ceil(transitSeconds / 60)} min transit` : '',
    commute && drivingSeconds != null ? `${Math.ceil(drivingSeconds / 60)} min drive` : '',
    listing.building?.stabilized && photoBadge !== 'Rent-stabilized' ? 'Rent-stabilized' : '',
    priceCut && !isNew ? '' : priceCut ? `Price cut ${formatRent(priceCut)}` : '',
    longListed ? `${listed}, worth negotiating` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const facts = discoveryFacts(listing);
  // What stands out, each as a heading and a line, as listing pages lead with theirs.
  const highlights: [string, string][] = [
    ...(badge && listing.insights?.marketMedian
      ? [
          [badge, `Median ${formatRent(listing.insights.marketMedian)} for ${listing.insights.comparedWith} similar apartments nearby`] as [
            string,
            string,
          ],
        ]
      : []),
    ...(listing.building?.stabilized
      ? [
          ['Rent-stabilized building', 'Registers rent-stabilized units with New York State; ask whether this unit is one.'] as [
            string,
            string,
          ],
        ]
      : []),
    ...(grade
      ? [[`Building grade ${grade}`, 'From open violations, complaints, bedbug filings and the flood zone.'] as [string, string]]
      : []),
    ...(listing.insights?.subway ?? []).map(
      ({ station, routes, minutes, accessible }) =>
        [`${station} · ${routes.join(' ')}`, `${minutes} min walk${accessible ? ' · accessible station' : ''}`] as [string, string],
    ),
    ...(priceCut ? [[`Price cut ${formatRent(priceCut)}`, 'Its last price change was a cut.'] as [string, string]] : []),
  ];
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
          {/* One badge on the photo, the most useful thing to know first. */}
          {photoBadge && (
            <View style={card.tags}>
              <Text style={card.tag}>{photoBadge}</Text>
            </View>
          )}
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
        <View style={{ gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text accessibilityRole="header" numberOfLines={1} style={[card.title, { flex: 1 }]}>
              {title}
            </Text>
            {grade && (
              <Text accessibilityLabel={`Building grade ${grade}`} style={card.grade}>
                Building {grade}
              </Text>
            )}
          </View>
          <Text numberOfLines={1} style={card.subtitle}>
            {place}
          </Text>
          <Text numberOfLines={1} style={card.subtitle}>
            {details}
          </Text>
          <Text style={card.priceLine}>
            <Text style={styles.price}>{presentation.priceKnown ? formatRent(rent) : 'Price unavailable'}</Text>
            {presentation.priceKnown && ' month'}
            {(listing.kind === 'snapshot' || listing.priceIncludesFees) &&
              (listing.kind === 'snapshot' ? ' · Recorded rent' : ' · Total price, fees included')}
            {badge ? <Text style={card.subtitle}> · {badge}</Text> : null}
          </Text>
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
            {original?.url ? (
              <ExternalLink
                url={original.url}
                onError={onError}
                accessibilityLabel={listingLinkLabel(original)}
                style={({ pressed }) => [styles.button, { alignSelf: 'stretch' }, pressed && styles.pressed]}
              >
                <Text style={styles.buttonText}>{listingLinkLabel(original)} ↗</Text>
              </ExternalLink>
            ) : null}
            <Text style={styles.smallMuted}>
              {checked}
              {['snapshot', 'cached'].includes(listing.kind) ? ' · Previously saved data' : ''}
              {listing.company
                ? ` · ${listing.companyFromSnapshot || listing.kind === 'snapshot' ? 'Snapshot advertiser' : 'Listed by'} ${listing.company}`
                : ''}
            </Text>
            {highlights.length > 0 && (
              <Section title="Highlights">
                {highlights.map(([heading, detail]) => (
                  <View key={heading} style={{ gap: 2 }}>
                    <Text style={card.highlight}>{heading}</Text>
                    <Text style={styles.smallMuted}>{detail}</Text>
                  </View>
                ))}
              </Section>
            )}
            <Section title="What it costs">
              <TypicalCost listing={listing} />
              <Disclosure title="Estimate the full cost of renting">
                <HousingCost />
              </Disclosure>
            </Section>
            <Section title="Getting there">
              <CommuteDetails listing={listing} />
              <View style={styles.cardLinks}>
                <Link label="Transit directions" url={directionsLink(listing, workplace)} onError={onError} />
                <Link label="Driving directions" url={directionsLink(listing, workplace, 'driving')} onError={onError} />
              </View>
            </Section>
            <Section title="About this listing">
              {knownFacts.length > 0 && <Text style={styles.bodyText}>{knownFacts.join(' · ')}</Text>}
              {listing.building && <BuildingSummary facts={listing.building} />}
              <PriceHistory value={listing.priceHistory} />
              <ListingSources listing={listing} onSaveLink={onSaveLink} onError={onError} />
              {/* NYC's building records cover the five boroughs only; elsewhere there is nothing to check. */}
              {searchBorough(listing) && (
                // The report loads when opened: violations, ownership and rent stabilization from NYC's records.
                <Disclosure title="NYC building records">
                  <BuildingReport key={listingKey(listing)} listing={listing} onError={onError} onCheckBuilding={onCheckBuilding} />
                </Disclosure>
              )}
            </Section>
            {saved && (
              <Section title="Your notes">
                <SavedNotes key={listingKey(listing)} identity={listingKey(listing)} />
              </Section>
            )}
            <Pressable accessibilityRole="button" onPress={() => setExpanded(false)} style={{ paddingVertical: 8 }}>
              <Text style={styles.linkText}>Hide details</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
