import { wholeNumber } from '../whole-number.ts';
import React, { useEffect, useState } from 'react';
import { SUBWAY_LINES } from '../subway.ts';
import { Pressable, Text, View } from 'react-native';
import { REGIONS, WORKPLACES } from '../regions.ts';
import { colors, styles } from '../styles.ts';
import { Button, Chip, Field } from './ui.tsx';
import { type DraftFilters, SEARCH_DEFAULTS, BEDROOMS, formDefaults } from '../app-shared.ts';

/** A filter section's heading, with a divider above it. */
const FILTER_HEADING = {
  fontSize: 18,
  lineHeight: 24,
  fontWeight: '600',
  color: colors.ink,
  borderTopWidth: 1,
  borderTopColor: colors.border,
  paddingTop: 20,
  marginTop: 8,
} as const;

/** The MTA's bullet colors for each line, and the text color that reads on it. */
function lineColors(line: string): [string, string] {
  if ('123'.includes(line)) return ['#EE352E', '#ffffff'];
  if ('456'.includes(line)) return ['#00933C', '#ffffff'];
  if (line === '7') return ['#B933AD', '#ffffff'];
  if ('ACE'.includes(line)) return ['#0039A6', '#ffffff'];
  if ('BDFM'.includes(line)) return ['#FF6319', '#ffffff'];
  if (line === 'G') return ['#6CBE45', '#ffffff'];
  if ('JZ'.includes(line)) return ['#996633', '#ffffff'];
  if (line === 'L') return ['#A7A9AC', '#222222'];
  if ('NQRW'.includes(line)) return ['#FCCC0A', '#222222'];
  return ['#808183', '#ffffff'];
}

/** The places offered, in one row: anywhere, the city and each borough, then the areas around it. */
const AREA_CHOICES: (readonly [string, string])[] = [
  ['all', 'Anywhere'],
  ['nyc', 'All NYC'],
  ['manhattan', 'Manhattan'],
  ['brooklyn', 'Brooklyn'],
  ['queens', 'Queens'],
  ['bronx', 'Bronx'],
  ['staten-island', 'Staten Island'],
  ['nj', 'New Jersey'],
  ['li', 'Long Island'],
  ['westchester', 'Westchester'],
  ['ct', 'Connecticut'],
];

/** Commute limits offered, in minutes; null is any. */
const COMMUTE_LIMITS: [number | null, string][] = [
  [null, 'Any'],
  [20, '20 min'],
  [30, '30 min'],
  [45, '45 min'],
  [60, '1 hour'],
];

export function Filters({
  draft,
  setDraft,
  submit,
  busy,
  serverState,
  connect,
  suggest,
  panel,
  commuteConfigured,
}: {
  draft: DraftFilters;
  setDraft: React.Dispatch<React.SetStateAction<DraftFilters>>;
  submit: () => void;
  busy: boolean;
  serverState: string;
  connect: () => void;
  /** Finds a typed destination, so it can be checked before it is applied. */
  /** Places matching what has been typed, for the destination field's suggestions. */
  suggest?: (query: string) => Promise<{ label: string; latitude: number; longitude: number }[]>;
  panel: string;
  commuteConfigured: boolean;
}) {
  const [linesOpen, setLinesOpen] = useState(false);
  const set =
    <K extends keyof DraftFilters>(field: K) =>
    (value: DraftFilters[K]) =>
      setDraft((previous) => ({ ...previous, [field]: value }));
  const destinationLabel =
    draft.workplace === 'custom'
      ? draft.customWorkplace.split(',')[0] || 'your destination'
      : (WORKPLACES[draft.workplace]?.label ?? 'work');
  const commuteLimit = (
    <>
      {/* How long the trip to the destination may be, from the transit estimates (no routing service needed). */}
      <Text accessibilityRole="header" style={FILTER_HEADING}>
        Commute
      </Text>
      <Text style={styles.smallMuted}>By subway or PATH to {destinationLabel}, estimated.</Text>
      <View style={styles.chipRow}>
        {COMMUTE_LIMITS.map(([minutes, label]) => (
          <Chip key={label} selected={(draft.maxCommuteMinutes ?? null) === minutes} onPress={() => set('maxCommuteMinutes')(minutes)}>
            {label}
          </Chip>
        ))}
      </View>
    </>
  );

  return (
    <View style={styles.sheetBody}>
      {draft.neighborhood ? (
        <View style={styles.chipRow}>
          <Chip selected onPress={() => set('neighborhood')('')} label={`Neighborhood ${draft.neighborhood}, remove`}>
            {draft.neighborhood} ✕
          </Chip>
        </View>
      ) : null}
      {(panel === 'more' || panel === 'price') && (
        <>
          <Text accessibilityRole="header" style={[FILTER_HEADING, { borderTopWidth: 0, paddingTop: 0, marginTop: 0 }]}>
            Price
          </Text>
          <Field
            label="Max rent per month ($)"
            placeholder="Any rent"
            value={String(draft.maxRent ?? '')}
            onChangeText={(text) => set('maxRent')(wholeNumber(text, 100000))}
            keyboardType="number-pad"
          />
        </>
      )}
      {(panel === 'more' || panel === 'beds') && (
        <>
          <Text accessibilityRole="header" style={FILTER_HEADING}>
            Bedrooms
          </Text>
          {/* Several sizes at once: tap each one wanted; Any clears them. */}
          <View style={styles.chipRow}>
            {BEDROOMS.map((beds) => {
              const chosen = draft.bedroomOptions?.length ? draft.bedroomOptions : draft.bedrooms === null ? [] : [draft.bedrooms];
              const selected = beds === null ? chosen.length === 0 : chosen.includes(beds);
              return (
                <Chip
                  key={String(beds)}
                  selected={selected}
                  onPress={() => {
                    const next = beds === null ? [] : selected ? chosen.filter((item) => item !== beds) : [...chosen, beds].sort();
                    setDraft((current) => ({ ...current, bedrooms: next.length === 1 ? next[0]! : null, bedroomOptions: next }));
                  }}
                >
                  {beds === null ? 'Any' : beds === 0 ? 'Studio' : beds === 4 ? '4+ BR' : `${beds} BR`}
                </Chip>
              );
            })}
          </View>
          <Text accessibilityRole="header" style={FILTER_HEADING}>
            Bathrooms
          </Text>
          <View style={styles.chipRow}>
            {([null, 1, 2, 3] as const).map((baths) => {
              const chosen = draft.bathroomOptions ?? [];
              const selected = baths === null ? chosen.length === 0 : chosen.includes(baths);
              return (
                <Chip
                  key={String(baths)}
                  label={
                    baths === null ? 'Any number of bathrooms' : `${baths === 3 ? '3 or more' : baths} bathroom${baths === 1 ? '' : 's'}`
                  }
                  selected={selected}
                  onPress={() =>
                    set('bathroomOptions')(
                      baths === null ? [] : selected ? chosen.filter((item) => item !== baths) : [...chosen, baths].sort(),
                    )
                  }
                >
                  {baths === null ? 'Any' : baths === 3 ? '3+' : String(baths)}
                </Chip>
              );
            })}
          </View>
          {panel === 'more' && (
            <>
              {/* Its own section, a tap each, as listing apps offer size. */}
              <Text accessibilityRole="header" style={FILTER_HEADING}>
                Size
              </Text>
              <View style={styles.chipRow}>
                {([null, 500, 750, 1000, 1500] as const).map((feet) => (
                  <Chip
                    key={String(feet)}
                    label={feet === null ? 'Any size' : `At least ${feet.toLocaleString('en-US')} square feet`}
                    selected={(draft.minSquareFeet == null || draft.minSquareFeet === '' ? null : Number(draft.minSquareFeet)) === feet}
                    onPress={() => set('minSquareFeet')(feet === null ? '' : String(feet))}
                  >
                    {feet === null ? 'Any' : `${feet.toLocaleString('en-US')}+ sq ft`}
                  </Chip>
                ))}
              </View>
            </>
          )}
        </>
      )}
      {(panel === 'more' || panel === 'area') && (
        <>
          <Text accessibilityRole="header" style={FILTER_HEADING}>
            Area
          </Text>
          {/* One row of places, the city's first; an area chosen elsewhere (a saved search) is shown too. */}
          <View style={styles.chipRow}>
            {[
              ...AREA_CHOICES,
              ...(AREA_CHOICES.some(([key]) => key === draft.region)
                ? []
                : [[draft.region, (REGIONS as Record<string, { label: string }>)[draft.region]?.label ?? draft.region] as const]),
            ].map(([key, label]) => (
              <Chip key={key} selected={draft.region === key} onPress={() => set('region')(key)}>
                {label}
              </Chip>
            ))}
          </View>
        </>
      )}
      {panel === 'more' && commuteLimit}
      {panel === 'more' && commuteConfigured && (
        <>
          <Text style={styles.fieldLabel}>Best fit weighs</Text>
          <View style={styles.chipRow}>
            {(
              [
                [80, 'Rent first'],
                [50, 'Rent and commute equally'],
                [20, 'Commute first'],
              ] as const
            ).map(([weight, label]) => (
              <Chip
                key={weight}
                selected={Number(draft.bestFitRentWeight ?? 60) === weight}
                onPress={() => set('bestFitRentWeight')(weight)}
              >
                {label}
              </Chip>
            ))}
          </View>
        </>
      )}
      {panel === 'more' && (
        <>
          <Text accessibilityRole="header" style={FILTER_HEADING}>
            Amenities
          </Text>
          {/* One tap each; a listing that does not say is hidden while one is on. Laundry is one or the other. */}
          <View style={styles.chipRow}>
            {(
              [
                ['Pets allowed', draft.petsRequired === true, () => set('petsRequired')(!draft.petsRequired)],
                ['Near subway', draft.nearSubway === true, () => set('nearSubway')(!draft.nearSubway)],
                ['Elevator station', draft.accessibleSubway === true, () => set('accessibleSubway')(!draft.accessibleSubway)],
                ['Laundry in unit', draft.laundry === 'in_unit', () => set('laundry')(draft.laundry === 'in_unit' ? '' : 'in_unit')],
                [
                  'Laundry in building',
                  draft.laundry === 'in_building',
                  () => set('laundry')(draft.laundry === 'in_building' ? '' : 'in_building'),
                ],
                ['Good buildings', draft.goodBuildings === true, () => set('goodBuildings')(!draft.goodBuildings)],
                ['Deals (20%+ below similar)', draft.belowMarket === true, () => set('belowMarket')(!draft.belowMarket)],
                ['Rent-stabilized', draft.stabilizedOnly === true, () => set('stabilizedOnly')(!draft.stabilizedOnly)],
              ] as const
            ).map(([label, selected, toggle]) => (
              <Chip key={label} selected={selected} onPress={toggle}>
                {label}
              </Chip>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: linesOpen }}
            onPress={() => setLinesOpen(!linesOpen)}
            style={{ paddingVertical: 6 }}
          >
            <Text style={styles.linkText}>
              {linesOpen
                ? 'Hide train lines'
                : draft.subwayLines?.length
                  ? `Train lines: ${draft.subwayLines.join(', ')}`
                  : 'Choose train lines'}
            </Text>
          </Pressable>
          {linesOpen && (
            <View style={styles.chipRow}>
              {SUBWAY_LINES.map((line) => {
                const on = draft.subwayLines?.includes(line) === true;
                const [background, text] = lineColors(line);
                return (
                  <Pressable
                    key={line}
                    accessibilityRole="button"
                    accessibilityLabel={`${line} train`}
                    aria-pressed={on}
                    accessibilityState={{ selected: on }}
                    onPress={() =>
                      set('subwayLines')(
                        on ? (draft.subwayLines ?? []).filter((item) => item !== line) : [...(draft.subwayLines ?? []), line],
                      )
                    }
                    style={({ pressed }) => ({
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      alignItems: 'center',
                      justifyContent: 'center',
                      // Chosen lines in their own color; the rest outlined, so the choice reads at a glance.
                      backgroundColor: on ? background : colors.white,
                      borderWidth: 2,
                      borderColor: on ? background : colors.border,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: on ? text : colors.ink, fontWeight: '700', fontSize: 15 }}>{line}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      )}
      {panel === 'commute' && (
        <>
          <Text style={styles.smallMuted}>Where you commute to. Typed places are looked up with OpenStreetMap.</Text>
          <View style={styles.chipRow}>
            {Object.entries(WORKPLACES).map(([key, workplace]) => (
              <Chip key={key} selected={draft.workplace === key} onPress={() => set('workplace')(key)}>
                {workplace.label}
              </Chip>
            ))}
            <Chip selected={draft.workplace === 'custom'} onPress={() => set('workplace')('custom')}>
              Custom
            </Chip>
          </View>
          {draft.workplace === 'custom' && (
            <DestinationField value={draft.customWorkplace} onChange={set('customWorkplace')} suggest={suggest} />
          )}
          {commuteLimit}
          {commuteConfigured ? (
            <>
              <Field
                label="Max transit time (minutes)"
                placeholder="Any transit time"
                value={String(draft.maxTransitMinutes ?? '')}
                onChangeText={(text) => set('maxTransitMinutes')(wholeNumber(text, 180))}
                keyboardType="number-pad"
              />
              <Field
                label="Max driving time (minutes)"
                placeholder="Any driving time"
                value={String(draft.maxDrivingMinutes ?? '')}
                onChangeText={(text) => set('maxDrivingMinutes')(wholeNumber(text, 180))}
                keyboardType="number-pad"
              />
              <Text style={styles.smallMuted}>
                Estimates are for arriving at your workplace on a weekday morning. Set both limits to require both.
              </Text>
            </>
          ) : (
            <>
              {((draft.maxTransitMinutes != null && draft.maxTransitMinutes !== '') ||
                (draft.maxDrivingMinutes != null && draft.maxDrivingMinutes !== '') ||
                draft.sort === 'transit' ||
                draft.sort === 'driving') && (
                <Button
                  secondary
                  onPress={() =>
                    setDraft((previous) => ({
                      ...previous,
                      maxTransitMinutes: '',
                      maxDrivingMinutes: '',
                      sort: previous.sort === 'transit' || previous.sort === 'driving' ? 'rent' : previous.sort,
                    }))
                  }
                >
                  Clear unavailable commute filters
                </Button>
              )}
            </>
          )}
        </>
      )}
      {serverState === 'offline' && (
        <Button secondary onPress={connect}>
          Retry connection
        </Button>
      )}
      {/* Clear on the left, show results on the right, above a divider. */}
      <View style={styles.sheetFooter}>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            panel === 'commute'
              ? setDraft((previous) => ({ ...previous, workplace: SEARCH_DEFAULTS.workplace, customWorkplace: '' }))
              : setDraft(formDefaults())
          }
          style={styles.reset}
        >
          <Text style={[styles.linkText, { fontSize: 15 }]}>{panel === 'commute' ? 'Reset destination' : 'Clear all'}</Text>
        </Pressable>
        <Button dark onPress={submit} disabled={busy}>
          {busy ? 'Searching…' : panel === 'commute' ? 'Apply destination' : 'Show apartments'}
        </Button>
      </View>
    </View>
  );
}

/**
 * A number field's text kept to what the search accepts as it is typed: digits only, at most `max`, never 0, so
 * "$4,500" becomes 4500 and 250000 becomes 100000 instead of an error after searching.
 */

type Place = { label: string; latitude: number; longitude: number };

/** A typed destination: an address or a place name, with suggestions from the map as it is typed. */
export function DestinationField({
  value,
  onChange,
  suggest,
}: {
  value: string;
  onChange: (value: string) => void;
  suggest?: (query: string) => Promise<Place[]>;
}) {
  // What the list shows: nothing yet, a search under way, its places, or that nothing matched.
  const [places, setPlaces] = useState<{ query: string; list: Place[]; state: 'idle' | 'searching' | 'done' }>({
    query: '',
    list: [],
    state: 'idle',
  });
  const [picked, setPicked] = useState('');
  const query = value.trim();
  // Asked once typing pauses, and only for the latest text; a choice closes the list.
  useEffect(() => {
    if (!suggest || query.length < 3 || query === picked) {
      setPlaces({ query: '', list: [], state: 'idle' });
      return;
    }
    let current = true;
    setPlaces((previous) => ({ ...previous, state: 'searching' }));
    const timer = setTimeout(() => {
      suggest(query)
        // An edited suggestion ("520 Madison Avenue, Manhatt") is searched again by its first part.
        .then((list) => (list.length || !query.includes(',') ? list : suggest(query.split(',')[0]!.trim())))
        .then((list) => current && setPlaces({ query, list, state: 'done' }))
        .catch(() => current && setPlaces({ query, list: [], state: 'done' }));
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, suggest, picked]);
  const choose = (place: Place) => {
    setPicked(place.label);
    onChange(place.label);
  };
  const open = query.length >= 3 && query !== picked;
  return (
    <View style={styles.tokenForm}>
      <Field
        label="Destination address or place"
        placeholder="Empire State Building, or 350 5th Ave"
        value={value}
        onChangeText={onChange}
        // Enter takes the first suggestion, as search boxes do.
        onSubmitEditing={() => places.list[0] && open && choose(places.list[0])}
        maxLength={160}
      />
      {open && places.list.length > 0 && (
        <View accessibilityRole="list" style={[styles.menu, places.state === 'searching' && { opacity: 0.6 }]}>
          {places.list.map((place, index) => (
            <Pressable
              key={place.label}
              accessibilityRole="button"
              accessibilityLabel={`Use ${place.label}`}
              onPress={() => choose(place)}
              style={({ pressed }) => [styles.menuRow, index > 0 && styles.menuDivider, pressed && styles.pressed]}
            >
              <Text style={styles.bodyText} numberOfLines={2}>
                {place.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {open && suggest && places.list.length === 0 && (
        <Text accessibilityRole="status" style={styles.smallMuted}>
          {places.state === 'done'
            ? `No places match “${query}”. Try a street address, like 350 5th Ave, or a landmark.`
            : 'Looking up places…'}
        </Text>
      )}
      {picked !== '' && picked === value && <Text style={styles.smallMuted}>Commute times will be to {picked}.</Text>}
    </View>
  );
}
