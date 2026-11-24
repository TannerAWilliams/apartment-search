import React, { useRef, useState } from 'react';
import { understand } from '../natural-search.ts';
import { SUBWAY_LINES } from '../subway.ts';
import { type ConfigSource } from '../api-client.ts';
import type { SearchFilters, SearchResult } from '../domain.ts';

import { Pressable, ScrollView, Text, View } from 'react-native';
import { REGIONS, WORKPLACES, marketsForSearch } from '../regions.ts';
import { marketplaceLinks } from '../marketplaces.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Field, Link } from './ui.tsx';
import { LAUNDRY_LABELS } from '../discovery.ts';
import { type DraftFilters, SEARCH_DEFAULTS, BEDROOMS, AREA_GROUPS, formDefaults } from '../app-shared.ts';

export function Filters({
  draft,
  setDraft,
  submit,
  busy,
  serverState,
  connect,
  lookUp,
  panel,
  commuteConfigured,
  websites,
  describe,
  loadNeighborhoods,
}: {
  draft: DraftFilters;
  setDraft: React.Dispatch<React.SetStateAction<DraftFilters>>;
  submit: () => void;
  busy: boolean;
  serverState: string;
  connect: () => void;
  /** Finds a typed destination, so it can be checked before it is applied. */
  lookUp?: (place: string) => Promise<{ label: string; latitude: number; longitude: number }>;
  panel: string;
  commuteConfigured: boolean;
  /** The listing-website filter, shown with the other filters. */
  websites?: React.ReactNode;
  /** Applies the filters a typed sentence asks for, and searches. */
  describe?: (changes: Partial<SearchFilters>) => void;
  /** New York City's neighborhoods, so a sentence can name one. */
  loadNeighborhoods?: (signal: AbortSignal) => Promise<{ areas?: { id: string; label: string; detail: string }[] }>;
}) {
  const [moreFilters, setMoreFilters] = useState(false);
  const [sentence, setSentence] = useState('');
  const [understood, setUnderstood] = useState<string[] | null>(null);
  const places = useRef<{ name: string; borough: string }[] | null>(null);
  async function search() {
    if (!places.current && loadNeighborhoods) {
      try {
        const { areas = [] } = await loadNeighborhoods(new AbortController().signal);
        places.current = areas.filter(({ id }) => id.includes('|')).map(({ label, detail }) => ({ name: label, borough: detail }));
      } catch {
        places.current = [];
      }
    }
    const result = understand(sentence, places.current ?? []);
    setUnderstood(result.understood);
    if (result.understood.length) describe?.(result.changes);
  }
  const set =
    <K extends keyof DraftFilters>(field: K) =>
    (value: DraftFilters[K]) =>
      setDraft((previous) => ({ ...previous, [field]: value }));

  return (
    <View style={styles.sheetBody}>
      {panel === 'more' && describe && (
        <>
          <Field
            label="Describe what you want"
            value={sentence}
            onChangeText={setSentence}
            maxLength={200}
            placeholder="2 bedroom in Park Slope under $4k with laundry"
          />
          <Button secondary disabled={busy || !sentence.trim()} onPress={() => void search()}>
            Search for this
          </Button>
          {understood && (
            <Text accessibilityRole="alert" style={styles.smallMuted}>
              {understood.length
                ? 'Searching for: ' + understood.join(' · ')
                : 'Try naming a size, a budget or an area, like “studio in Queens under $2,500”.'}
            </Text>
          )}
        </>
      )}
      {draft.neighborhood ? (
        <View style={styles.chipRow}>
          <Chip selected onPress={() => set('neighborhood')('')} label={`Neighborhood ${draft.neighborhood}, remove`}>
            {draft.neighborhood} ✕
          </Chip>
        </View>
      ) : null}
      {(panel === 'more' || panel === 'beds') && (
        <>
          <Text style={styles.fieldLabel}>Bedrooms</Text>
          <View style={styles.chipRow}>
            {BEDROOMS.map((beds) => (
              <Chip key={String(beds)} selected={draft.bedrooms === beds} onPress={() => set('bedrooms')(beds)}>
                {beds === null ? 'Any' : beds === 0 ? 'Studio' : `${beds} BR`}
              </Chip>
            ))}
          </View>
        </>
      )}
      {(panel === 'more' || panel === 'area') && (
        <>
          <Text style={styles.fieldLabel}>Area</Text>
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
            onChangeText={set('zip')}
            keyboardType="number-pad"
            maxLength={5}
          />
        </>
      )}
      {(panel === 'more' || panel === 'price') && (
        <>
          <Field
            label="Max rent per month ($)"
            placeholder="Any rent"
            value={String(draft.maxRent ?? '')}
            onChangeText={set('maxRent')}
            keyboardType="number-pad"
            maxLength={6}
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
          <Text style={styles.fieldLabel}>Value and building</Text>
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
          <Text style={styles.fieldLabel}>Subway</Text>
          <View style={styles.chipRow}>
            <Chip selected={draft.nearSubway === true} onPress={() => set('nearSubway')(!draft.nearSubway)}>
              Within a 10-minute walk
            </Chip>
            {SUBWAY_LINES.map((line) => (
              <Chip
                key={line}
                label={`${line} train`}
                selected={draft.subwayLines?.includes(line) === true}
                onPress={() =>
                  set('subwayLines')(
                    draft.subwayLines?.includes(line)
                      ? draft.subwayLines.filter((item) => item !== line)
                      : [...(draft.subwayLines ?? []), line],
                  )
                }
              >
                {line}
              </Chip>
            ))}
          </View>
          {(draft.stabilizedOnly || draft.goodBuildings) && (
            <Text style={styles.smallMuted}>
              Rent stabilization comes from the state’s list of registered buildings; grades come from city records for buildings checked so
              far, and more are checked every night.
            </Text>
          )}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: moreFilters }} onPress={() => setMoreFilters(!moreFilters)}>
            <Text style={styles.linkText}>{moreFilters ? 'Fewer filters ▴' : 'More filters: bathrooms, size, pets, laundry ▾'}</Text>
          </Pressable>
        </>
      )}
      {panel === 'more' && moreFilters && (
        <>
          <Text style={styles.smallMuted}>Apartments whose listing does not say are left out when you require a feature.</Text>
          <Field
            label="Minimum bathrooms"
            value={draft.minBathrooms == null ? '' : String(draft.minBathrooms)}
            onChangeText={set('minBathrooms')}
            placeholder="Any / unknown allowed"
            keyboardType="decimal-pad"
          />
          <Field
            label="Minimum square feet"
            value={draft.minSquareFeet == null ? '' : String(draft.minSquareFeet)}
            onChangeText={set('minSquareFeet')}
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
            <DestinationField value={draft.customWorkplace} onChange={set('customWorkplace')} lookUp={lookUp} />
          )}
          {commuteConfigured ? (
            <>
              <Field
                label="Max transit time (minutes)"
                placeholder="Any transit time"
                value={String(draft.maxTransitMinutes ?? '')}
                onChangeText={set('maxTransitMinutes')}
                keyboardType="number-pad"
                maxLength={3}
              />
              <Field
                label="Max driving time (minutes)"
                placeholder="Any driving time"
                value={String(draft.maxDrivingMinutes ?? '')}
                onChangeText={set('maxDrivingMinutes')}
                keyboardType="number-pad"
                maxLength={3}
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

/** A typed destination: an address or a place name, with a check that shows what it was matched to. */
function DestinationField({
  value,
  onChange,
  lookUp,
}: {
  value: string;
  onChange: (value: string) => void;
  lookUp?: (place: string) => Promise<{ label: string; latitude: number; longitude: number }>;
}) {
  const [found, setFound] = useState<{ text: string; message: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    if (!lookUp || value.trim().length < 4) return;
    setBusy(true);
    try {
      const place = await lookUp(value.trim());
      setFound({
        text: value,
        message: `Found: ${place.label} (${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)})`,
        error: false,
      });
    } catch (caught) {
      setFound({ text: value, message: caught instanceof Error ? caught.message : 'That place could not be found.', error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.tokenForm}>
      <Field
        label="Destination address or place"
        placeholder="Empire State Building, or 350 5th Ave, New York"
        value={value}
        onChangeText={(text) => {
          onChange(text);
          setFound(null);
        }}
        maxLength={160}
      />
      {lookUp && (
        <Button secondary onPress={() => void check()} disabled={busy || value.trim().length < 4}>
          {busy ? 'Looking up…' : 'Check address'}
        </Button>
      )}
      {found && found.text === value && (
        <Text accessibilityRole={found.error ? 'alert' : undefined} style={found.error ? styles.error : styles.smallMuted}>
          {found.message}
        </Text>
      )}
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
