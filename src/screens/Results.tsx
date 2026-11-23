import React, { useState } from 'react';
import { inventoryUnavailable } from '../inventory-state.ts';
import type { ListingData, SourceLink, SearchFilters, SearchResult } from '../domain.ts';

import { Pressable, Text, View } from 'react-native';
import { REGIONS } from '../regions.ts';
import { MARKETPLACE_NAMES } from '../marketplaces.ts';
import { RESULT_SORTS, bedroomLabel, formatRent, needsCommute } from '../search.ts';
import { styles } from '../styles.ts';
import { listingKey, mergeSourceLinks } from '../listings.ts';
import { Button, Chip } from '../components/ui.tsx';
import { Listing } from '../components/Listing.tsx';
import { PAGE_SIZE } from '../app-shared.ts';

export function ResultNotices({ notices = [] }: { notices?: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!notices.length) return null;
  return (
    <View style={[{ gap: 4 }, expanded && { flexBasis: '100%' }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Hide coverage notes' : 'Show coverage notes'}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
      >
        <Text style={styles.linkText}>
          {notices.length} coverage {notices.length === 1 ? 'note' : 'notes'} {expanded ? '▴' : '▾'}
        </Text>
      </Pressable>
      {expanded &&
        notices.map((notice, index) => (
          <Text key={`${index}-${notice}`} style={styles.smallMuted}>
            • {notice}
          </Text>
        ))}
    </View>
  );
}

export function Results({
  visible,
  setVisible,
  result,
  applied,
  sort,
  onSort,
  onPage,
  paging,
  openCommute,
  commuteConfigured,
  checkingInventory,
  columns,
  savedByKey,
  showMarkets,
  showSources,
  onSave,
  onSaveLink,
  onRemove,
  onError,
  onCheckBuilding,
  status,
}: {
  visible: number;
  setVisible: (value: number) => void;
  result: SearchResult;
  applied: SearchFilters;
  sort: string;
  onSort: (sort: string) => void;
  onPage?: (offset: number) => void;
  paging: boolean;
  openCommute: () => void;
  commuteConfigured: boolean;
  checkingInventory: boolean;
  /** How many cards fit side by side. */
  columns: number;
  savedByKey: Map<string, ListingData>;
  showMarkets: () => void;
  showSources: () => void;
  onSave: (listing: ListingData) => void;
  onSaveLink: (listing: ListingData, link: SourceLink) => void;
  onRemove: (listing: ListingData) => void;
  onError: (message: string) => void;
  onCheckBuilding?: React.ComponentProps<typeof Listing>['onCheckBuilding'];
  /** One line on how fresh the sources are, shown with the coverage notes. */
  status?: React.ReactNode;
}) {
  const { matches } = result;
  const savedView = result.mode === 'saved';
  // A sort with only one option (saved apartments without routing) is not a choice, so it is not shown.
  const sortOptions = Object.entries(RESULT_SORTS).filter(
    // Best fit and the commute sorts weigh travel times, so they are offered only where there are travel times.
    ([id]) => id === 'rent' || (!savedView && commuteConfigured && id !== 'recent'),
  );
  const unavailable = inventoryUnavailable(result);
  const summary = savedView
    ? 'Saved on this device · All apartment sizes'
    : [
        Object.entries(REGIONS).find(([key]) => key === applied.region)?.[1].label ?? applied.region,
        bedroomLabel(applied.bedrooms),
        applied.zip,
        applied.company,
        MARKETPLACE_NAMES[applied.source],
        applied.maxRent === null ? null : `Up to ${formatRent(applied.maxRent)}`,
        applied.maxTransitMinutes == null ? null : `Transit ≤ ${applied.maxTransitMinutes} min`,
        applied.maxDrivingMinutes == null ? null : `Drive ≤ ${applied.maxDrivingMinutes} min`,
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <>
      {!(savedView && matches.length === 0) && (
        <View style={styles.resultHeading}>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" style={styles.panelTitle}>
              {!savedView && checkingInventory && result.total === 0
                ? 'Checking availability…'
                : unavailable
                  ? 'Active inventory unavailable'
                  : `${result.total.toLocaleString('en-US')} ${savedView ? 'saved' : 'matching'} ${result.total === 1 ? 'apartment' : 'apartments'}`}
            </Text>
            {!savedView && (applied.zip || applied.source || applied.maxTransitMinutes != null || applied.maxDrivingMinutes != null) && (
              <Text style={styles.smallMuted}>{summary}</Text>
            )}
          </View>
          {sortOptions.length > 1 && (
            <View style={styles.chipRow}>
              {sortOptions.map(([id, label]) => (
                <Chip key={id} selected={sort === id} onPress={() => onSort(id)}>
                  {label}
                </Chip>
              ))}
            </View>
          )}
        </View>
      )}
      {result.commute && <Text style={styles.smallMuted}>Weekday-morning estimates from TravelTime.</Text>}
      {result.commuteNotice && <Text style={styles.smallMuted}>{result.commuteNotice}</Text>}
      {(status || (result.notices?.length ?? 0) > 0) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, marginTop: -6 }}>
          {status}
          <ResultNotices notices={result.notices} />
        </View>
      )}
      {matches.length === 0 && (savedView || !checkingInventory) && (
        <View style={styles.empty}>
          <Text accessibilityRole="header" style={styles.panelTitle}>
            {savedView ? 'Your saved list is empty' : unavailable ? 'No inventory to search yet' : 'No matching rentals'}
          </Text>
          <Text style={styles.bodyText}>
            {savedView
              ? 'Save a result or add an apartment you found on a rental platform.'
              : unavailable
                ? 'No sources have supplied recently checked active inventory. This is not a finding that no apartments match your budget or area. Check source status or browse the rental platforms directly.'
                : applied.source
                  ? 'This website has no recently checked matches. Check its website for current availability.'
                  : needsCommute(applied)
                    ? 'Try a longer commute limit, or change the area or budget.'
                    : 'Try another area, website, bedroom count, or budget.'}
          </Text>
          {unavailable && (
            <Button secondary onPress={showSources}>
              Check source status
            </Button>
          )}
          {!savedView && !unavailable && needsCommute(applied) && (
            <Button secondary onPress={openCommute}>
              Edit commute filters
            </Button>
          )}
          <Button secondary onPress={showMarkets}>
            Browse rental platforms
          </Button>
        </View>
      )}
      <View style={styles.listingGrid}>
        {matches.slice(0, visible).map((listing) => {
          const saved = savedByKey.get(listingKey(listing));
          const withLinks = saved ? { ...listing, sources: mergeSourceLinks(listing.sources, saved.sources) } : listing;
          return (
            <View key={listing.id} style={columns === 3 ? styles.gridCard3 : columns === 2 ? styles.gridCard : styles.fullCard}>
              <Listing
                listing={withLinks}
                selectedSource={savedView ? '' : applied.source}
                workplace={result.workplace}
                commute={result.commute === true}
                onCheckBuilding={onCheckBuilding}
                onSave={onSave}
                onSaveLink={onSaveLink}
                onError={onError}
                onRemove={savedView ? onRemove : undefined}
                saved={Boolean(saved)}
              />
            </View>
          );
        })}
      </View>
      {!savedView && onPage && visible >= matches.length && (
        <View style={styles.chipRow}>
          {(result.offset ?? 0) > 0 && (
            <Button secondary disabled={paging} onPress={() => onPage(Math.max(0, result.offset - result.pageSize))}>
              Previous 100
            </Button>
          )}
          {result.nextOffset != null && (
            <Button secondary disabled={paging} onPress={() => onPage(result.nextOffset ?? 0)}>
              Next 100
            </Button>
          )}
        </View>
      )}
      {visible < matches.length && (
        <Button secondary onPress={() => setVisible(visible + PAGE_SIZE)}>
          Show more ({Math.min(visible, matches.length)} of {matches.length})
        </Button>
      )}
    </>
  );
}
