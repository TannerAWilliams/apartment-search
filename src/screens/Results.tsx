import React, { useContext, useMemo, useRef, useState } from 'react';
import { HiddenContext } from '../hooks/use-hidden.ts';
import { inventoryUnavailable } from '../inventory-state.ts';
import type { ListingData, SourceLink, SearchFilters, SearchResult } from '../domain.ts';

import { Pressable, Text, View } from 'react-native';
import { REGIONS } from '../regions.ts';
import { MARKETPLACE_NAMES } from '../marketplaces.ts';
import { RESULT_SORTS, bedroomsLabel, formatRent, needsCommute } from '../search.ts';
import { colors, styles } from '../styles.ts';
import { listingKey, mergeSourceLinks } from '../listings.ts';
import { AlertButton, Button, Chip, toggleProps } from '../components/ui.tsx';
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

/** A small button that opens a list of choices over the cards (sorting, and the extra tools). */
function ChipMenu({
  label,
  title,
  items,
  onChoose,
}: {
  label: string;
  title: string;
  items: [id: string, label: string, selected: boolean][];
  onChoose: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ position: 'relative' }}>
      <Chip label={label} selected={open} onPress={() => setOpen(!open)}>
        {`${title} ▾`}
      </Chip>
      {open && (
        <View
          accessibilityRole="menu"
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            minWidth: 220,
            backgroundColor: colors.white,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingVertical: 6,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            zIndex: 20,
          }}
        >
          {items.map(([id, itemLabel, selected]) => (
            <Pressable
              key={id}
              accessibilityRole="menuitem"
              accessibilityLabel={itemLabel}
              {...toggleProps(selected)}
              onPress={() => {
                setOpen(false);
                onChoose(id);
              }}
              style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 10 }, pressed && styles.pressed]}
            >
              <Text style={{ fontSize: 15, color: colors.ink, fontWeight: selected ? '700' : '400' }}>
                {selected ? '✓ ' : ''}
                {itemLabel}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/** Commute limits offered on the results bar, in minutes; null is any. */
const COMMUTE_CHOICES: [number | null, string][] = [
  [null, 'Any commute'],
  [20, '20 min'],
  [30, '30 min'],
  [45, '45 min'],
  [60, '1 hour'],
];
const commuteLabel = (minutes: number | null | undefined) =>
  minutes == null ? 'Any' : (COMMUTE_CHOICES.find(([value]) => value === minutes)?.[1] ?? `${minutes} min`);

/** Sorting as one button that opens its choices, instead of a row of every sort. */
function SortMenu({ options, sort, onSort }: { options: [string, string][]; sort: string; onSort: (sort: string) => void }) {
  const current = options.find(([id]) => id === sort)?.[1] ?? options[0]?.[1];
  return (
    <ChipMenu
      label={`Sort: ${current}`}
      title={`Sort: ${current}`}
      items={options.map(([id, label]) => [id, label, sort === id])}
      onChoose={onSort}
    />
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
  onAlert,
  onOpen,
  searching = false,
  destination,
  tools = [],
  onTool,
  onCommute,
}: {
  /** Sets the longest commute to the destination, from the results bar. */
  onCommute?: (minutes: number | null) => void;
  /** Where commute times are to, and a way to change it, shown under the count. */
  destination?: { label: string; onChange: () => void };
  /** Extra tools for this list (saved searches, price changes), in a More menu. */
  tools?: [id: string, label: string, selected: boolean][];
  onTool?: (id: string) => void;
  /** A new search is on its way: the count says so and the cards still shown are dimmed until it comes. */
  searching?: boolean;
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
  /** Opens the alert form for this search; given where the button belongs in this row (a phone). */
  onAlert?: () => void;
  /** Opens an apartment's own page. */
  onOpen?: (listing: ListingData) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  // The cards' actions keep one identity across renders, so memoized cards are not redrawn because the page
  // passed a new function; each call still reaches the latest handler.
  const latest = useRef({ onSave, onSaveLink, onRemove, onError, onOpen });
  latest.current = { onSave, onSaveLink, onRemove, onError, onOpen };
  const actions = useMemo(
    () => ({
      onSave: (listing: ListingData) => latest.current.onSave(listing),
      onSaveLink: (listing: ListingData, link: SourceLink) => latest.current.onSaveLink(listing, link),
      onRemove: (listing: ListingData) => latest.current.onRemove(listing),
      onError: (message: string) => latest.current.onError(message),
      onOpen: (listing: ListingData) => latest.current.onOpen?.(listing),
      onExpandedChange: (id: string, expanded: boolean) =>
        setOpen((current) => {
          const next = new Set(current);
          if (expanded) next.add(id);
          else next.delete(id);
          return next;
        }),
    }),
    [],
  );
  const savedView = result.mode === 'saved';
  // Apartments this person hid are left out of their results (never out of their saved list).
  const { hidden, showAll } = useContext(HiddenContext);
  const matches = savedView ? result.matches : result.matches.filter((listing) => !hidden.has(listingKey(listing)));
  const hiddenHere = result.matches.length - matches.length;
  const shown = matches.slice(0, visible);
  const coverage = (status || (result.notices?.length ?? 0) > 0) && (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2 }}>
      {status}
      <ResultNotices notices={result.notices} />
    </View>
  );
  // Cards after the last open one, which takes a whole row; they decide how full the last row is.
  const lastOpen = shown.findLastIndex(({ id }) => open.has(id));
  const cardsAfterOpen = shown.length - lastOpen - 1;
  // A sort with only one option (saved apartments without routing) is not a choice, so it is not shown.
  const sortOptions = Object.entries(RESULT_SORTS).filter(
    // Best fit and the commute sorts weigh travel times, so they are offered only where there are travel times.
    // Newest and best value need the whole inventory's history and medians, which saved apartments do not have.
    ([id]) => id === 'rent' || (!savedView && (id === 'newest' || id === 'value')) || (!savedView && commuteConfigured && id !== 'recent'),
  );
  const unavailable = inventoryUnavailable(result);
  const summary = savedView
    ? 'Saved on this device · All apartment sizes'
    : [
        Object.entries(REGIONS).find(([key]) => key === applied.region)?.[1].label ?? applied.region,
        bedroomsLabel(applied),
        applied.zip,
        applied.company,
        MARKETPLACE_NAMES[applied.source],
        applied.maxRent === null ? null : `Up to ${formatRent(applied.maxRent)}`,
        applied.maxTransitMinutes == null ? null : `Transit ≤ ${applied.maxTransitMinutes} min`,
        applied.maxDrivingMinutes == null ? null : `Drive ≤ ${applied.maxDrivingMinutes} min`,
        applied.maxCommuteMinutes == null ? null : `Commute ≤ ${applied.maxCommuteMinutes} min`,
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <>
      {!(savedView && matches.length === 0) && (
        // Above the cards, so the sort menu opens over them.
        <View style={[styles.resultHeading, { zIndex: 10, position: 'relative' }]}>
          <View style={styles.headingCopy}>
            <Text accessibilityRole="header" style={{ fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.ink }}>
              {!savedView && searching
                ? 'Searching…'
                : !savedView && checkingInventory && result.total === 0
                  ? 'Checking availability…'
                  : unavailable
                    ? 'Apartments couldn’t be loaded'
                    : `${result.total.toLocaleString('en-US')} ${savedView ? 'saved' : 'matching'} ${result.total === 1 ? 'apartment' : 'apartments'}`}
            </Text>
            {!savedView &&
              (applied.zip ||
                applied.source ||
                applied.maxTransitMinutes != null ||
                applied.maxDrivingMinutes != null ||
                applied.maxCommuteMinutes != null) && <Text style={styles.smallMuted}>{summary}</Text>}
            {hiddenHere > 0 && showAll && (
              <Pressable accessibilityRole="button" onPress={showAll} style={{ alignSelf: 'flex-start', paddingVertical: 2 }}>
                <Text style={styles.smallMuted}>
                  {hiddenHere} hidden by you · <Text style={styles.linkText}>Show hidden apartments</Text>
                </Text>
              </Pressable>
            )}
            {destination && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={destination.label ? 'Change destination' : 'Add where you work'}
                onPress={destination.onChange}
                style={({ pressed }) => [{ alignSelf: 'flex-start', paddingVertical: 2 }, pressed && styles.pressed]}
              >
                <Text numberOfLines={1} style={styles.smallMuted}>
                  {destination.label ? (
                    <>
                      Commute times to <Text style={{ color: colors.ink, fontWeight: '600' }}>{destination.label}</Text> ·{' '}
                      <Text style={styles.linkText}>Change</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.linkText}>Add where you work</Text> to see each commute
                    </>
                  )}
                </Text>
              </Pressable>
            )}
          </View>
          {/* One row: the count, then sorting as a single menu and alerts as one small button. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, zIndex: 10 }}>
            {!savedView && onAlert && result.total > 0 && <AlertButton onPress={onAlert} />}
            {sortOptions.length > 1 && <SortMenu options={sortOptions} sort={sort} onSort={onSort} />}
            {/* How long the trip to work may be, one tap from the results. */}
            {!savedView && onCommute && (
              <ChipMenu
                label={`Commute: ${commuteLabel(applied.maxCommuteMinutes)}`}
                title={applied.maxCommuteMinutes == null ? 'Commute' : `≤ ${commuteLabel(applied.maxCommuteMinutes)}`}
                items={COMMUTE_CHOICES.map(([minutes, label]) => [String(minutes), label, (applied.maxCommuteMinutes ?? null) === minutes])}
                onChoose={(id) => onCommute(id === 'null' ? null : Number(id))}
              />
            )}
            {tools.length > 0 && onTool && <ChipMenu label="More tools" title="More" items={tools} onChoose={onTool} />}
          </View>
        </View>
      )}
      {!savedView && applied.belowMarket && <Text style={styles.smallMuted}>Deals are at least 20% below similar apartments nearby.</Text>}
      {result.commute && <Text style={styles.smallMuted}>Weekday-morning estimates from TravelTime.</Text>}
      {result.commuteNotice && <Text style={styles.smallMuted}>{result.commuteNotice}</Text>}
      {/* Where the listings come from is shown only to explain an empty result; the Sources page has it all. */}
      {matches.length === 0 && coverage}
      {matches.length === 0 && (savedView || !checkingInventory) && (
        <View style={styles.empty}>
          <Text accessibilityRole="header" style={styles.panelTitle}>
            {savedView ? 'Your saved list is empty' : unavailable ? 'We couldn’t load apartments just now' : 'No apartments match'}
          </Text>
          <Text style={styles.bodyText}>
            {savedView
              ? 'Save a result or add an apartment you found on a rental platform.'
              : unavailable
                ? 'The listings didn’t arrive, so this isn’t an empty result for your search. Try again in a moment, or browse the rental sites directly.'
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
      <View style={[styles.listingGrid, !savedView && searching && { opacity: 0.45 }]} aria-busy={!savedView && searching}>
        {shown.map((listing) => {
          const saved = savedByKey.get(listingKey(listing));
          const withLinks = saved ? { ...listing, sources: mergeSourceLinks(listing.sources, saved.sources) } : listing;
          return (
            <View
              key={listing.id}
              style={open.has(listing.id) || columns === 1 ? styles.fullCard : columns === 3 ? styles.gridCard3 : styles.gridCard}
            >
              <Listing
                listing={withLinks}
                selectedSource={savedView ? '' : applied.source}
                workplace={result.workplace}
                commute={result.commute === true}
                onCheckBuilding={onCheckBuilding}
                onSave={actions.onSave}
                onSaveLink={actions.onSaveLink}
                onError={actions.onError}
                onRemove={savedView ? actions.onRemove : undefined}
                saved={Boolean(saved)}
                onExpandedChange={actions.onExpandedChange}
                onOpen={onOpen ? actions.onOpen : undefined}
              />
            </View>
          );
        })}
        {/* Empty cells fill the last row, so its cards keep the same width as the rows above. */}
        {columns > 1 &&
          Array.from({ length: (columns - (cardsAfterOpen % columns)) % columns }, (_, index) => (
            <View key={`filler-${index}`} style={columns === 3 ? styles.gridCard3 : styles.gridCard} />
          ))}
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
