import React from 'react';
import { SignIn } from './SignIn.tsx';
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
  token,
  setToken,
  connect,
  onSignedIn,
  account,
  onSignOut,
  panel,
  commuteConfigured,
}: {
  draft: DraftFilters;
  setDraft: React.Dispatch<React.SetStateAction<DraftFilters>>;
  submit: () => void;
  busy: boolean;
  serverState: string;
  token: string;
  setToken: (value: string) => void;
  connect: () => void;
  /** After an email-code sign-in, with the session token for the native app. */
  onSignedIn: (token: string) => void;
  /** The email signed in with a code, with a way to sign out. */
  account: string | null;
  onSignOut: () => void;
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

          <Field
            label="Listing company (optional)"
            placeholder="Compass, SERHANT., Corcoran…"
            value={draft.company}
            onChangeText={set('company')}
            maxLength={80}
          />

          <View style={styles.divider} />
        </>
      )}
      {(panel === 'more' || panel === 'commute') && (
        <>
          <SectionTitle index="02">Commute destination</SectionTitle>
          <Text style={styles.smallMuted}>
            Choose a preset or enter a custom destination. Editing stays on this device until you apply. Applying an address sends it to the
            U.S. Census geocoder; when estimates are enabled, apartment and destination coordinates are sent to TravelTime. Directions links
            open only when you tap them.
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
            <Field
              label="Workplace street address or coordinates"
              placeholder={serverState === 'ready' ? 'Street, city, state, ZIP' : '40.75874, -73.97867'}
              value={draft.customWorkplace}
              onChangeText={set('customWorkplace')}
              maxLength={160}
            />
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
          {serverState !== 'ready' && (
            <Text style={styles.smallMuted}>
              Search and destination changes need the search server. Draft edits remain on this device until you apply after reconnecting.
            </Text>
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
      {serverState === 'locked' && <SignIn onSignedIn={onSignedIn} />}
      {serverState === 'locked' && (
        <View style={styles.tokenForm}>
          <Text style={styles.smallMuted}>Or connect with the server access token.</Text>
          <Field
            label="Server access token"
            placeholder="Enter your server token"
            value={token}
            onChangeText={setToken}
            secureTextEntry
            maxLength={256}
          />
          <Button secondary onPress={connect}>
            Connect to server
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

  return (
    <View style={styles.websiteFilter}>
      <Text style={styles.fieldLabel}>Listing website</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketChips}>
        <Chip selected={!applied.source} onPress={() => onSelect('')}>
          All websites
        </Chip>
        <Chip selected={applied.source === 'streeteasy'} onPress={() => onSelect('streeteasy')}>
          {'StreetEasy' + (streetEasy ? ' (' + streetEasy.count.toLocaleString('en-US') + ')' : '')}
        </Chip>
        {counts
          .filter(({ id }) => id !== 'streeteasy')
          .map(({ id, name, count }) => (
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
