import React, { useState } from 'react';
import { type ConfigSource } from '../api-client.ts';
import type { SearchFilters, SearchResult } from '../domain.ts';

import { Pressable, ScrollView, Text, View } from 'react-native';
import { REGIONS, WORKPLACES, marketsForSearch } from '../regions.ts';
import { marketplaceLinks } from '../marketplaces.ts';
import { DEFAULT_FILTERS, formatRent } from '../search.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Field, Link, SectionTitle } from './ui.tsx';
import { LAUNDRY_LABELS } from '../discovery.ts';
import { type DraftFilters, SEARCH_DEFAULTS, BEDROOMS, AREA_GROUPS, formDefaults } from '../app-shared.ts';

export function Filters({
  draft,
  setDraft,
  submit,
  busy,
  serverState,
  connect,
  account,
  onSignOut,
  lookUp,
  panel,
  commuteConfigured,
}: {
  draft: DraftFilters;
  setDraft: React.Dispatch<React.SetStateAction<DraftFilters>>;
  submit: () => void;
  busy: boolean;
  serverState: string;
  connect: () => void;
  /** The email signed in with a code, with a way to sign out. */
  account: string | null;
  onSignOut: () => void;
  /** Finds a typed destination, so it can be checked before it is applied. */
  lookUp?: (place: string) => Promise<{ label: string; latitude: number; longitude: number }>;
  panel: string;
  commuteConfigured: boolean;
}) {
  const set =
    <K extends keyof DraftFilters>(field: K) =>
    (value: DraftFilters[K]) =>
      setDraft((previous) => ({ ...previous, [field]: value }));

  return (
    <View style={styles.filters}>
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
          <View style={styles.chipRow}>
            <Chip selected={draft.maxRent === ''} onPress={() => set('maxRent')('')}>
              Any price
            </Chip>
            <Chip
              selected={draft.maxRent === String(DEFAULT_FILTERS.maxRent)}
              onPress={() => set('maxRent')(String(DEFAULT_FILTERS.maxRent))}
            >
              Up to {formatRent(DEFAULT_FILTERS.maxRent ?? 5000)}
            </Chip>
          </View>
        </>
      )}
      {panel === 'more' && (
        <>
          <Text style={styles.fieldLabel}>Best-fit priorities</Text>
          <Field
            label="Rent ranking weight (0–100)"
            value={String(draft.bestFitRentWeight ?? 60)}
            onChangeText={set('bestFitRentWeight')}
            keyboardType="number-pad"
            maxLength={3}
          />
          <Text style={styles.smallMuted}>
            Commute receives the remaining weight out of 100. Applies to Best fit sorting only. Missing estimates earn no points; changing
            weights does not request a route.
          </Text>
          <View style={styles.chipRow}>
            {[0, 25, 50, 60, 75, 100].map((weight) => (
              <Chip
                key={weight}
                selected={Number(draft.bestFitRentWeight ?? 60) === weight}
                onPress={() => set('bestFitRentWeight')(weight)}
              >
                Rent {weight} / commute {100 - weight}
              </Chip>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Reported apartment features</Text>
          <Text style={styles.smallMuted}>
            Filters require explicit source data. Unknown details are excluded when a feature is required; verify with the landlord.
          </Text>
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

          <View style={styles.divider} />
        </>
      )}
      {(panel === 'more' || panel === 'commute') && (
        <>
          <SectionTitle index="02">Commute destination</SectionTitle>
          <Text style={styles.smallMuted}>
            Choose a preset or type any address or place. Editing stays on this device until you apply. A typed destination is looked up
            with OpenStreetMap (and the U.S. Census geocoder for exact addresses); when estimates are enabled, apartment and destination
            coordinates are sent to TravelTime. Directions links open only when you tap them.
          </Text>
          <Text style={styles.fieldLabel}>Destination</Text>
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
              <Text style={styles.smallMuted}>
                Automatic transit and driving estimates are unavailable. You can still change your destination and use directions links; no
                travel times will be invented.
              </Text>
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
      {serverState === 'ready' && account && panel === 'more' && (
        <View style={styles.tokenForm}>
          <Text style={styles.smallMuted}>Signed in as {account}</Text>
          <Button secondary onPress={onSignOut}>
            Sign out
          </Button>
        </View>
      )}
      <View style={styles.submit}>
        <Button onPress={submit} disabled={busy}>
          {busy ? 'Searching…' : panel === 'commute' ? 'Apply destination' : 'Search apartments →'}
        </Button>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            panel === 'commute'
              ? setDraft((previous) => ({ ...previous, workplace: SEARCH_DEFAULTS.workplace, customWorkplace: '' }))
              : setDraft(formDefaults())
          }
          style={styles.reset}
        >
          <Text style={styles.linkText}>{panel === 'commute' ? 'Reset destination' : 'Reset filters'}</Text>
        </Pressable>
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
