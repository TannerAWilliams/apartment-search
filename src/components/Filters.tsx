import { wholeNumber } from '../whole-number.ts';
import React, { useEffect, useState } from 'react';
import { SUBWAY_LINES } from '../subway.ts';
import { type ConfigSource } from '../api-client.ts';
import type { SearchFilters, SearchResult } from '../domain.ts';

import { Pressable, ScrollView, Text, View } from 'react-native';
import { REGIONS, WORKPLACES, marketsForSearch } from '../regions.ts';
import { marketplaceLinks } from '../marketplaces.ts';
import { colors, styles } from '../styles.ts';
import { Button, Chip, Field, Link } from './ui.tsx';
import { LAUNDRY_LABELS } from '../discovery.ts';
import { type DraftFilters, SEARCH_DEFAULTS, BEDROOMS, AREA_GROUPS, formDefaults } from '../app-shared.ts';

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
  websites,
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
  /** The listing-website filter, shown with the other filters. */
  websites?: React.ReactNode;
}) {
  const [moreFilters, setMoreFilters] = useState(false);
  const set =
    <K extends keyof DraftFilters>(field: K) =>
    (value: DraftFilters[K]) =>
      setDraft((previous) => ({ ...previous, [field]: value }));

  return (
    <View style={styles.sheetBody}>
      {draft.neighborhood ? (
        <View style={styles.chipRow}>
          <Chip selected onPress={() => set('neighborhood')('')} label={`Neighborhood ${draft.neighborhood}, remove`}>
            {draft.neighborhood} ✕
          </Chip>
        </View>
      ) : null}
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
          {(draft.bathroomOptions?.length ?? 0) > 0 && (
            <Text style={styles.smallMuted}>Listings that do not say how many bathrooms they have are left out.</Text>
          )}
        </>
      )}
      {(panel === 'more' || panel === 'area') && (
        <>
          <Text accessibilityRole="header" style={FILTER_HEADING}>
            Area
          </Text>
          <View style={styles.chipRow}>
            <Chip selected={draft.region === 'all'} onPress={() => set('region')('all')}>
              {REGIONS.all.label}
            </Chip>
          </View>
          {AREA_GROUPS.map(([heading, keys]) => (
            <React.Fragment key={heading}>
              <Text style={styles.smallMuted}>{heading}</Text>
              <View style={styles.chipRow}>
                {keys.map((key) => (
                  <Chip key={key} selected={draft.region === key} onPress={() => set('region')(key)}>
                    {key === 'nyc' ? 'All five boroughs' : REGIONS[key].label}
                  </Chip>
                ))}
              </View>
            </React.Fragment>
          ))}
          <Field
            label="ZIP code (optional)"
            placeholder="Any ZIP in this area"
            value={draft.zip}
            onChangeText={(text) => set('zip')(text.replace(/\D/g, '').slice(0, 5))}
            keyboardType="number-pad"
          />
        </>
      )}
      {(panel === 'more' || panel === 'price') && (
        <>
          <Field
            label="Max rent per month ($)"
            placeholder="Any rent"
            value={String(draft.maxRent ?? '')}
            onChangeText={(text) => set('maxRent')(wholeNumber(text, 100000))}
            keyboardType="number-pad"
          />
        </>
      )}
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
            Value and building
          </Text>
          <View style={styles.chipRow}>
            <Chip selected={draft.belowMarket === true} onPress={() => set('belowMarket')(!draft.belowMarket)}>
              Below similar apartments
            </Chip>
            <Chip selected={draft.stabilizedOnly === true} onPress={() => set('stabilizedOnly')(!draft.stabilizedOnly)}>
              Rent-stabilized buildings
            </Chip>
            <Chip selected={draft.goodBuildings === true} onPress={() => set('goodBuildings')(!draft.goodBuildings)}>
              Hide buildings graded C or D
            </Chip>
          </View>
          <Text accessibilityRole="header" style={FILTER_HEADING}>
            New on Walkup
          </Text>
          <View style={styles.chipRow}>
            {([null, 1, 3, 7, 14] as const).map((days) => (
              <Chip
                key={String(days)}
                selected={(draft.newWithinDays ?? null) === days}
                onPress={() => set('newWithinDays')(days ?? undefined)}
              >
                {days === null ? 'Any time' : days === 1 ? 'Last day' : `Last ${days} days`}
              </Chip>
            ))}
          </View>
          <Text accessibilityRole="header" style={FILTER_HEADING}>
            Subway
          </Text>
          <View style={styles.chipRow}>
            <Chip selected={draft.nearSubway === true} onPress={() => set('nearSubway')(!draft.nearSubway)}>
              Within a 10-minute walk
            </Chip>
            <Chip selected={draft.accessibleSubway === true} onPress={() => set('accessibleSubway')(!draft.accessibleSubway)}>
              Accessible station (elevators)
            </Chip>
          </View>
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
                    backgroundColor: background,
                    opacity: on ? 1 : pressed ? 0.7 : 0.4,
                    borderWidth: on ? 3 : 0,
                    borderColor: colors.ink,
                  })}
                >
                  <Text style={{ color: text, fontWeight: '700', fontSize: 15 }}>{line}</Text>
                </Pressable>
              );
            })}
          </View>
          {(draft.stabilizedOnly || draft.goodBuildings) && (
            <Text style={styles.smallMuted}>
              Rent stabilization comes from the state’s list of registered buildings; grades come from city records for buildings checked so
              far, and more are checked every night.
            </Text>
          )}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: moreFilters }} onPress={() => setMoreFilters(!moreFilters)}>
            <Text style={styles.linkText}>{moreFilters ? 'Fewer filters ▴' : 'More filters: size, pets, laundry ▾'}</Text>
          </Pressable>
        </>
      )}
      {panel === 'more' && moreFilters && (
        <>
          <Text style={styles.smallMuted}>Apartments whose listing does not say are left out when you require a feature.</Text>
          <Field
            label="Minimum square feet"
            value={draft.minSquareFeet == null ? '' : String(draft.minSquareFeet)}
            onChangeText={(text) => set('minSquareFeet')(wholeNumber(text, 100000))}
            placeholder="Any / unknown allowed"
            keyboardType="number-pad"
          />
          <View style={styles.chipRow}>
            <Chip selected={draft.petsRequired === true} onPress={() => set('petsRequired')(!draft.petsRequired)}>
              Require pets allowed
            </Chip>
            <Chip selected={!draft.laundry} onPress={() => set('laundry')('')}>
              Any laundry / unknown allowed
            </Chip>
            {Object.entries(LAUNDRY_LABELS).map(([value, label]) => (
              <Chip key={value} selected={draft.laundry === value} onPress={() => set('laundry')(value)}>
                {label}
              </Chip>
            ))}
          </View>
        </>
      )}
      {panel === 'more' && websites}
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
  const [places, setPlaces] = useState<{ query: string; list: Place[] }>({ query: '', list: [] });
  const [picked, setPicked] = useState('');
  // Asked once typing pauses, and only for the latest text; a choice closes the list.
  useEffect(() => {
    const query = value.trim();
    if (!suggest || query.length < 3 || query === picked) {
      setPlaces({ query: '', list: [] });
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      suggest(query)
        .then((list) => current && setPlaces({ query, list }))
        .catch(() => current && setPlaces({ query, list: [] }));
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [value, suggest, picked]);
  return (
    <View style={styles.tokenForm}>
      <Field
        label="Destination address or place"
        placeholder="Empire State Building, or 350 5th Ave, New York"
        value={value}
        onChangeText={onChange}
        maxLength={160}
      />
      {places.list.length > 0 && (
        <View accessibilityRole="list" style={styles.menu}>
          {places.list.map((place, index) => (
            <Pressable
              key={place.label}
              accessibilityRole="button"
              accessibilityLabel={`Use ${place.label}`}
              onPress={() => {
                setPicked(place.label);
                onChange(place.label);
              }}
              style={({ pressed }) => [styles.menuRow, index > 0 && styles.menuDivider, pressed && styles.pressed]}
            >
              <Text style={styles.bodyText} numberOfLines={2}>
                {place.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {picked !== '' && picked === value && <Text style={styles.smallMuted}>Commute times will be to {picked}.</Text>}
    </View>
  );
}

export function WebsiteFilter({
  result,
  applied,
  onSelect,
  onError,
  configuredSources,
}: {
  result: SearchResult;
  applied: SearchFilters | DraftFilters;
  onSelect: (source: string) => void;
  onError: (message: string) => void;
  configuredSources: ConfigSource[];
}) {
  const counts = [...(result.sourceCounts ?? [])];
  for (const source of configuredSources)
    if (!counts.some(({ id }) => id === source.id)) counts.push({ ...source, count: 0, checkedCount: 0 });
  const streetEasy = counts.find(({ id }) => id === 'streeteasy');
  const areas = marketsForSearch(applied);
  // Only websites with listings to show, and the one already chosen; nothing to choose between, no filter.
  const choices = counts.filter(({ id, count }) => count > 0 || applied.source === id);
  if (choices.length < 2 && !applied.source) return null;

  return (
    <View style={styles.websiteFilter}>
      <Text style={styles.fieldLabel}>Listing website</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketChips}>
        <Chip selected={!applied.source} onPress={() => onSelect('')}>
          All websites
        </Chip>
        {choices.map(({ id, name, count }) => (
          <Chip key={id} selected={applied.source === id} onPress={() => onSelect(id)}>
            {name + ' (' + count.toLocaleString('en-US') + ')'}
          </Chip>
        ))}
      </ScrollView>
      {applied.source === 'streeteasy' && (
        <View style={styles.actionLinks}>
          {(!streetEasy || !streetEasy.checkedCount) && (
            <Text style={styles.smallMuted}>
              StreetEasy’s dated export supplies rent charts. Browse StreetEasy for its current listings.
            </Text>
          )}
          {areas.map((area) => {
            const link = marketplaceLinks(area, {
              ...applied,
              maxRent: applied.maxRent === '' || applied.maxRent === null ? null : Number(applied.maxRent),
            }).find(({ id }) => id === 'streeteasy');
            return link ? <Link key={area.label} label={`Browse ${area.label} on StreetEasy`} url={link.url} onError={onError} /> : null;
          })}
        </View>
      )}
    </View>
  );
}
