import type { ListingData } from '../domain.ts';
import type { RentArea, RentMarket, RentHistory } from '../rent-history.ts';
import type { LoadHistory } from '../screens/MarketHistory.tsx';
import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { formatSnapshotMonth, rentAreas, SNAPSHOT_MONTH, SNAPSHOT_SOURCE } from '../market.ts';
// Resolves to offline-rent-data.web.ts on the web, which bundles no data.
import { offlineRentData } from '../offline-rent-data';
import { NYC_BOROUGHS, searchBorough } from '../regions.ts';
import { formatRent } from '../search.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Disclosure, Field, Link, toggleProps } from './ui.tsx';
import { LongTrend } from './LongTrend.tsx';
import { DASHBOARD_URL } from '../dashboard-data.ts';
import { MarketHistory } from '../screens/MarketHistory.tsx';
import { RentTrend } from './RentTrend.tsx';
import { StatTile } from './MarketCharts.tsx';
import { rentSeries } from '../rent-history.ts';

const SIZES = ['Studio', '1 BR', '2 BR', '3 BR', '4 BR'];
const PAGE_SIZE = 5;

/** The states the snapshot covers, and the region each one asks the server for. */
const STATES = [
  ['all', 'All', ''],
  ['nyc', 'New York', ', NY'],
  ['nj', 'New Jersey', ', NJ'],
  ['ct', 'Connecticut', ', CT'],
] as const;
/** The time ranges, in months; the snapshot covers the most recent six, StreetEasy the rest. */
const SNAPSHOT_RANGE = 6;
const RANGES = [
  [6, '6 months'],
  [12, '1 year'],
  [36, '3 years'],
  [60, '5 years'],
  [120, '10 years'],
  [0, 'Since 2010'],
] as const;
type State = (typeof STATES)[number][0];
/** How the chart's area was chosen: the whole state, a borough or city, a neighborhood, or a ZIP code. */
type Level = 'state' | 'city' | 'neighborhood' | 'zip';
type Choice = { level: Level; id: string };
const STATE_CHOICE: Choice = { level: 'state', id: 'overall' };
const CHIP_LIMIT = 8;

/** The borough key a search region names, as the snapshot labels it ("Staten Island, NY"). */
const BOROUGH_LABELS: Record<string, string> = Object.fromEntries(
  NYC_BOROUGHS.map((key) => [key, (key === 'staten-island' ? 'Staten Island' : key[0]!.toUpperCase() + key.slice(1)) + ', NY']),
);

/** Where the chart starts: the borough or state of the search, when the snapshot covers it. */
function startingPoint(region: string): { state: State; choice: Choice } {
  if (BOROUGH_LABELS[region]) return { state: 'nyc', choice: { level: 'city', id: BOROUGH_LABELS[region]! } };
  if (region === 'nyc' || region === 'manhattan-brooklyn') return { state: 'nyc', choice: STATE_CHOICE };
  if (region === 'nj') return { state: 'nj', choice: STATE_CHOICE };
  return { state: 'all', choice: STATE_CHOICE };
}

/** A row of choices: one line that scrolls sideways on a phone, wrapping lines on a wider screen. */
function ChipLine({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  if (width >= 700) return <View style={styles.chipRow}>{children}</View>;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.chipRow, { flexWrap: 'nowrap', paddingRight: 8 }]}
    >
      {children}
    </ScrollView>
  );
}

/** The StreetEasy area for the chosen one: New York City, a borough or a neighborhood by name; others are named as they are. */
function historyArea(choice: Choice, state: State, label: string | undefined) {
  if (choice.level === 'state') return state === 'nj' ? 'New Jersey' : state === 'ct' ? 'Connecticut' : 'NYC';
  return (label ?? '').replace(/, (NY|NJ)$/, '');
}

/** The chosen area's median for the chosen size, its change since last month, and how many listings it has. */
function TodayTiles({ area, bedrooms, month, history }: { area: RentArea; bedrooms: number; month: string; history: RentHistory }) {
  const points = rentSeries(area, bedrooms, month, history);
  const current = points.at(-1)?.median ?? null;
  const before = points.at(-2)?.median ?? null;
  const delta = current !== null && before ? (current - before) / before : null;
  return (
    <View style={[styles.chipRow, { alignItems: 'stretch' }]}>
      <StatTile
        label={`Median ${SIZES[bedrooms]} · ${area.label}`}
        value={current === null ? 'No listings' : formatRent(current)}
        delta={delta === null ? '' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta * 100).toFixed(1)}% vs last month`}
        period={formatSnapshotMonth(month)}
        values={points.map(({ median }) => median)}
      />
      <StatTile
        label="Listed now"
        value={area.count.toLocaleString('en-US')}
        delta={`${(area.sizes[bedrooms]?.count ?? 0).toLocaleString('en-US')} of them ${SIZES[bedrooms]}`}
        period={formatSnapshotMonth(month)}
        values={points.map(({ count }) => count)}
      />
    </View>
  );
}

export function RentChart({
  initialRegion,
  saved,
  onError,
  showSaved,
  loadMarket,
  loadHistory,
}: {
  initialRegion: string;
  saved: ListingData[];
  onError: (message: string) => void;
  showSaved: () => void;
  loadMarket?: (region: string, grouping: string, signal: AbortSignal) => Promise<RentMarket>;
  loadHistory?: LoadHistory;
}) {
  const start = startingPoint(initialRegion);
  const [dataset, setDataset] = useState('market');
  const [state, setState] = useState<State>(start.state);
  const [choice, setChoice] = useState<Choice>(start.choice);
  const [zip, setZip] = useState('');
  const [allNeighborhoods, setAllNeighborhoods] = useState(false);
  const [range, setRange] = useState<number>(SNAPSHOT_RANGE);
  const [bedrooms, setBedrooms] = useState(1);
  const [pinned, setPinned] = useState<string[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loaded, setLoaded] = useState<Record<string, RentMarket | 'failed'>>({});

  // The groupings this view needs: boroughs and cities always, neighborhoods once one is chosen, ZIPs once one is typed.
  const groupings = [
    'city',
    ...(choice.level === 'city' || choice.level === 'neighborhood' ? ['neighborhood'] : []),
    ...(zip ? ['zip'] : []),
  ];
  const keyOf = (grouping: string) => `${dataset}|${state}|${grouping}`;
  const wanted = groupings.map(keyOf).join(',');
  useEffect(() => {
    if (dataset !== 'market' || !loadMarket) return;
    const controller = new AbortController();
    for (const grouping of groupings) {
      const key = keyOf(grouping);
      if (loaded[key]) continue;
      loadMarket(state, grouping, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          // An answer without areas is treated as a failed load, never as an empty market.
          const valid = Array.isArray(data?.areas) && Array.isArray(data.history) && typeof data.month === 'string';
          setLoaded((current) => ({ ...current, [key]: valid ? data : 'failed' }));
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoaded((current) => ({ ...current, [key]: 'failed' }));
        });
    }
    return () => controller.abort();
    // biome-ignore lint/correctness/useExhaustiveDependencies: `wanted` names every grouping and key used here
  }, [wanted, loadMarket]);

  /** One grouping's areas and history, from the server, the native app's bundled snapshot, or saved listings. */
  function figures(grouping: string): RentMarket | 'loading' | 'failed' {
    if (dataset === 'saved') return { month: SNAPSHOT_MONTH, areas: rentAreas(saved, { region: state, grouping }), history: [] };
    const remote = loaded[keyOf(grouping)];
    if (remote) return remote;
    if (offlineRentData)
      return {
        month: SNAPSHOT_MONTH,
        areas: rentAreas(offlineRentData.listings(), { region: state, grouping }),
        history: offlineRentData.history(SNAPSHOT_MONTH, state, grouping),
      };
    return loadMarket ? 'loading' : 'failed';
  }
  const cities = figures('city');
  const neighborhoods = groupings.includes('neighborhood') ? figures('neighborhood') : null;
  const zips = zip ? figures('zip') : null;
  const ready = (value: RentMarket | 'loading' | 'failed' | null) => (value && typeof value === 'object' ? value : null);
  const marketState = typeof cities === 'object' ? 'ready' : cities;
  const month = ready(cities)?.month ?? SNAPSHOT_MONTH;

  // Every area at every level, and one history for all of them (their ids never collide), so pins can mix levels.
  const known = [ready(cities), ready(neighborhoods), ready(zips)].filter((value): value is RentMarket => value !== null);
  const byId = new Map(known.flatMap(({ areas }) => areas.map((area) => [area.id, area] as const)));
  const history = useMemo<RentHistory>(() => {
    const periods = new Map<string, RentHistory[number][1]>();
    for (const { history } of known) for (const [period, rows] of history) periods.set(period, [...(periods.get(period) ?? []), ...rows]);
    return [...periods].sort(([a], [b]) => a.localeCompare(b));
    // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed when any grouping's figures change
  }, [cities, neighborhoods, zips]);

  const stateCities = (ready(cities)?.areas ?? []).filter(({ id }) => id !== 'overall');
  const cityId = choice.level === 'city' ? choice.id : choice.level === 'neighborhood' ? (choice.id.split('|')[0] ?? '') : '';
  const cityNeighborhoods = (ready(neighborhoods)?.areas ?? []).filter(({ id }) => id.startsWith(cityId + '|'));
  // The chips put the neighborhoods with the most listings first; the table below keeps them alphabetical.
  const busiestNeighborhoods = [...cityNeighborhoods].sort((a, b) => b.count - a.count);
  const selected = byId.get(choice.id);
  const stateLabel = STATES.find(([id]) => id === state)![1];
  const displayed = selected && choice.level === 'state' ? { ...selected, label: state === 'all' ? 'All areas' : stateLabel } : selected;
  const pinnedAreas = pinned.map((id) => byId.get(id)).filter((area): area is RentArea => Boolean(area));
  // The table lists the level below the choice: cities in a state, neighborhoods in a city, ZIP codes for a ZIP.
  const tableAreas =
    choice.level === 'zip'
      ? (ready(zips)?.areas ?? []).filter(({ id }) => id !== 'overall')
      : choice.level === 'state'
        ? stateCities
        : cityNeighborhoods;
  const levelName = state === 'nyc' ? 'Borough' : state === 'nj' || state === 'ct' ? 'City or town' : 'Borough or city';

  function choose(next: Choice) {
    setChoice(next);
    setVisible(PAGE_SIZE);
    if (next.level !== 'zip') setZip('');
  }
  function chooseState(next: State) {
    setState(next);
    setPinned([]);
    setAllNeighborhoods(false);
    choose(STATE_CHOICE);
  }
  function chooseZip(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 5);
    setZip(digits);
    if (digits.length < 5) {
      if (choice.level === 'zip') setChoice(STATE_CHOICE);
      return;
    }
    // A ZIP is looked up across both states, so it is found whichever state was chosen.
    if (state !== 'all' && !(state === 'nyc' && searchBorough({ state: 'NY', zip: digits }))) setState('all');
    setChoice({ level: 'zip', id: digits });
  }

  const shownNeighborhoods = allNeighborhoods ? cityNeighborhoods : busiestNeighborhoods.slice(0, CHIP_LIMIT);
  // The list under the chart: the next level down, by the chosen size's median, highest first.
  const ranked = [...tableAreas]
    .filter(({ sizes }) => sizes[bedrooms]?.median !== null && (sizes[bedrooms]?.count ?? 0) > 0)
    .sort((a, b) => (b.sizes[bedrooms]?.median ?? 0) - (a.sizes[bedrooms]?.median ?? 0));
  const listTitle =
    choice.level === 'state'
      ? state === 'nyc'
        ? 'Boroughs'
        : state === 'ct' || state === 'nj'
          ? 'Cities and towns'
          : 'Boroughs, cities and towns'
      : choice.level === 'zip'
        ? 'ZIP codes'
        : 'Neighborhoods';
  const snapshotSource = state === 'ct' ? 'Walkup’s own listings' : 'FirstMover’s monthly snapshot of new listings';
  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          Rent prices
        </Text>
        <Text style={styles.bodyText}>What apartments rent for in each area, and how that has changed.</Text>
      </View>
      <View style={styles.chartControls}>
        <Text style={styles.fieldLabel}>State</Text>
        <ChipLine>
          {STATES.map(([id, label]) => (
            <Chip key={id} selected={state === id} onPress={() => chooseState(id)}>
              {label}
            </Chip>
          ))}
        </ChipLine>
        {state !== 'all' && stateCities.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>{levelName}</Text>
            <ChipLine>
              {stateCities.map(({ id, label }) => (
                <Chip
                  key={id}
                  label={`${levelName} ${label}`}
                  selected={cityId === id}
                  onPress={() => {
                    setAllNeighborhoods(false);
                    choose({ level: 'city', id });
                  }}
                >
                  {label.replace(/, (NY|NJ|CT)$/, '')}
                </Chip>
              ))}
            </ChipLine>
          </>
        )}
        {cityId !== '' && cityNeighborhoods.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>Neighborhood</Text>
            <ChipLine>
              {shownNeighborhoods.map(({ id, label }) => (
                <Chip
                  key={id}
                  label={`Neighborhood ${label}`}
                  selected={choice.id === id}
                  onPress={() => choose(choice.id === id ? { level: 'city', id: cityId } : { level: 'neighborhood', id })}
                >
                  {label}
                </Chip>
              ))}
              {cityNeighborhoods.length > CHIP_LIMIT && (
                <Chip onPress={() => setAllNeighborhoods(!allNeighborhoods)}>
                  {allNeighborhoods ? 'Show fewer' : `All ${cityNeighborhoods.length} neighborhoods`}
                </Chip>
              )}
            </ChipLine>
          </>
        )}
        <View style={{ maxWidth: 240 }}>
          <Field label="ZIP code" placeholder="e.g. 11215" value={zip} onChangeText={chooseZip} maxLength={5} keyboardType="number-pad" />
        </View>
        <Text style={styles.fieldLabel}>Size</Text>
        <ChipLine>
          {SIZES.map((label, index) => {
            // Each size shows its median here, so every size's rent is readable without a chart of its own.
            const median = displayed?.sizes[index]?.median;
            return (
              <Chip key={label} label={label} selected={bedrooms === index} onPress={() => setBedrooms(index)}>
                {median ? `${label} · ${formatRent(Math.round(median))}` : label}
              </Chip>
            );
          })}
        </ChipLine>
      </View>
      {dataset === 'saved' && (
        <Text style={styles.bodyText}>
          Showing your saved apartments.{' '}
          <Text accessibilityRole="link" style={styles.linkText} onPress={() => (setDataset('market'), chooseState(state))}>
            Back to all listings
          </Text>
        </Text>
      )}
      {displayed ? (
        <>
          <TodayTiles area={displayed} bedrooms={bedrooms} month={month} history={history} />
          <Text accessibilityRole="header" style={styles.sectionHeading}>
            Median rent over time
          </Text>
          <ChipLine>
            {RANGES.map(([count, label]) => (
              <Chip key={label} selected={range === count} onPress={() => setRange(count)}>
                {label}
              </Chip>
            ))}
          </ChipLine>
          <View style={styles.chartCard}>
            <Text style={styles.fieldLabel}>
              {SIZES[bedrooms]} · {displayed.label}
            </Text>
            {range === SNAPSHOT_RANGE || dataset === 'saved' ? (
              <>
                <RentTrend
                  areas={[displayed, ...pinnedAreas.filter(({ id }) => id !== displayed.id)]}
                  bedrooms={bedrooms}
                  month={month}
                  history={history}
                  compact
                />
                <Text style={styles.smallMuted}>
                  Source: {dataset === 'saved' ? 'your saved apartments' : snapshotSource}. Monthly medians of asking rents.
                </Text>
                <View style={styles.chartCompare}>
                  <View style={styles.chipRow}>
                    {!pinned.includes(displayed.id) && pinned.length < 2 && (
                      <Chip onPress={() => setPinned([...pinned, displayed.id])}>+ Compare {displayed.label}</Chip>
                    )}
                    {pinnedAreas.map(({ id, label }) => (
                      <Chip key={id} selected onPress={() => setPinned(pinned.filter((item) => item !== id))}>
                        {label} ×
                      </Chip>
                    ))}
                  </View>
                  {pinned.length > 0 && <Text style={styles.smallMuted}>Now choose another area above to see both.</Text>}
                </View>
              </>
            ) : loadHistory ? (
              <LongTrend load={loadHistory} area={historyArea(choice, state, displayed.label)} bedrooms={bedrooms} months={range} />
            ) : (
              <Text style={styles.smallMuted}>Longer history needs the online server.</Text>
            )}
          </View>
          {ranked.length > 0 && (
            <>
              <Text accessibilityRole="header" style={styles.sectionHeading}>
                {listTitle}, {SIZES[bedrooms]}
              </Text>
              <View style={styles.menu}>
                {ranked.slice(0, visible).map((area, index) => (
                  <Pressable
                    key={area.id}
                    accessibilityRole="button"
                    {...toggleProps(choice.id === area.id)}
                    accessibilityLabel={`Show chart for ${area.label} ${area.detail}`}
                    onPress={() =>
                      choose(
                        choice.level === 'state'
                          ? { level: 'city', id: area.id }
                          : choice.level === 'zip'
                            ? { level: 'zip', id: area.id }
                            : { level: 'neighborhood', id: area.id },
                      )
                    }
                    style={({ pressed }) => [styles.menuRow, index > 0 && styles.menuDivider, pressed && styles.pressed]}
                  >
                    <Text style={[styles.menuLabel, { flex: 1 }]} numberOfLines={2}>
                      {area.label.replace(/, (NY|NJ|CT)$/, '')}
                    </Text>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.menuLabel}>{formatRent(Math.round(area.sizes[bedrooms]!.median!))}</Text>
                      <Text style={styles.smallMuted}>{area.sizes[bedrooms]!.count.toLocaleString('en-US')} listed</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
              {visible < ranked.length && (
                <Button secondary onPress={() => setVisible(ranked.length)}>
                  Show all {ranked.length}
                </Button>
              )}
            </>
          )}
        </>
      ) : marketState !== 'ready' && dataset === 'market' ? (
        <View style={styles.empty} aria-live="polite">
          <Text accessibilityRole="header" style={styles.panelTitle}>
            {marketState === 'loading' ? 'Loading rent data…' : 'Rent data is unavailable'}
          </Text>
          {marketState === 'failed' && <Text style={styles.bodyText}>The rent figures could not be loaded. Try again shortly.</Text>}
        </View>
      ) : choice.level === 'zip' && zips === 'loading' ? (
        <View style={styles.empty} aria-live="polite">
          <Text accessibilityRole="header" style={styles.panelTitle}>
            Loading ZIP codes…
          </Text>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text accessibilityRole="header" style={styles.panelTitle}>
            {choice.level === 'zip' ? `No listings in ${choice.id}` : 'No rents here yet'}
          </Text>
          <Text style={styles.bodyText}>
            {choice.level === 'zip'
              ? 'There are no asking rents in that ZIP code right now. Try a nearby one, or choose a borough or neighborhood.'
              : dataset === 'market'
                ? 'There are no listings to measure here right now.'
                : 'Save apartments in this area to compare their rents.'}
          </Text>
          {dataset === 'saved' && (
            <Button secondary onPress={showSaved}>
              Open saved apartments
            </Button>
          )}
        </View>
      )}
      {dataset === 'market' && loadHistory && (
        <Disclosure title="More market data from StreetEasy: inventory, price cuts, rankings">
          <MarketHistory load={loadHistory} area={historyArea(choice, state, displayed?.label)} />
        </Disclosure>
      )}
      <Disclosure title="Where these numbers come from">
        <View style={styles.chartSource}>
          <Text style={styles.smallMuted}>
            Recent months, New York City and New Jersey: median asking rents of new listings in FirstMover’s monthly snapshot, since May
            2026.
          </Text>
          <Link label="FirstMover snapshot data" url={SNAPSHOT_SOURCE} onError={onError} />
          <Text style={styles.smallMuted}>
            Longer history, New York City only: StreetEasy’s Data Dashboard, monthly since 2010, by borough and neighborhood.
          </Text>
          <Link label="StreetEasy Data Dashboard" url={DASHBOARD_URL} onError={onError} />
          <Text style={styles.smallMuted}>Connecticut: medians of the apartments currently listed on Walkup.</Text>
        </View>
      </Disclosure>
      {dataset === 'market' && (
        <Pressable accessibilityRole="button" onPress={() => (setDataset('saved'), chooseState(state))} style={{ paddingVertical: 6 }}>
          <Text style={styles.linkText}>Compare with your saved apartments</Text>
        </Pressable>
      )}
    </View>
  );
}
