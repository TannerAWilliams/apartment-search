import type { ListingData } from '../domain.ts';
import type { RentArea, RentMarket, RentHistory } from '../rent-history.ts';
import type { LoadHistory } from '../screens/MarketHistory.tsx';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { formatSnapshotMonth, rentAreas, SNAPSHOT_MONTH, SNAPSHOT_SOURCE } from '../market.ts';
// Resolves to offline-rent-data.web.ts on the web, which bundles no data.
import { offlineRentData } from '../offline-rent-data';
import { NYC_BOROUGHS, searchBorough } from '../regions.ts';
import { bedroomLabel, formatRent } from '../search.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Field, Link, toggleProps } from './ui.tsx';
import { MarketHistory } from '../screens/MarketHistory.tsx';
import { RentTrend } from './RentTrend.tsx';

const SIZES = ['Studio', '1 BR', '2 BR', '3 BR', '4 BR'];
// One series (median rent by size), so one color for every bar.
const BAR_COLORS = ['#2a78d6', '#2a78d6', '#2a78d6', '#2a78d6', '#2a78d6'];
const PAGE_SIZE = 15;

function MedianBars({ area }: { area: RentArea }) {
  const largest = Math.max(1, ...area.sizes.map(({ median }) => median ?? 0));
  return (
    <View style={styles.chartCard}>
      <Text accessibilityRole="header" style={styles.panelTitle}>
        {area.label}
      </Text>
      <Text style={styles.smallMuted}>{[area.detail, `${area.count.toLocaleString('en-US')} listings`].filter(Boolean).join(' · ')}</Text>
      {area.sizes.map(({ median, count }, index) => (
        <View
          key={SIZES[index]}
          style={styles.barRow}
          accessibilityLabel={`${bedroomLabel(index)}, ${median === null ? 'no observations' : formatRent(Math.round(median)) + ' median asking rent, ' + count + ' listings'}`}
        >
          <Text style={styles.barLabel}>{SIZES[index]}</Text>
          <View style={styles.barTrack}>
            {median !== null && (
              <View style={[styles.barFill, { width: `${(median / largest) * 100}%`, backgroundColor: BAR_COLORS[index] }]} />
            )}
          </View>
          <View style={styles.barValue}>
            <Text style={styles.chartPrice}>{median === null ? '—' : formatRent(Math.round(median))}</Text>
            <Text style={styles.chartCount}>{count === 0 ? 'No data' : `n = ${count}`}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function RentTable({ areas, selection, choose }: { areas: RentArea[]; selection: string; choose: (id: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      keyboardShouldPersistTaps="handled"
      accessibilityLabel="Median asking rent table, swipe horizontally for more bedroom sizes"
    >
      <View style={styles.chartTable}>
        <View style={styles.chartTableHeader}>
          <Text style={[styles.chartTablePlace, styles.fieldLabel]}>Area</Text>
          {SIZES.map((label) => (
            <Text key={label} style={[styles.chartCell, styles.fieldLabel]}>
              {label}
            </Text>
          ))}
        </View>
        {areas.map((area) => (
          <Pressable
            key={area.id}
            accessibilityRole="button"
            {...toggleProps(selection === area.id)}
            accessibilityLabel={`Show chart for ${area.label} ${area.detail}`}
            onPress={() => choose(area.id)}
            style={[styles.chartTableRow, selection === area.id && styles.chartTableSelected]}
          >
            <View style={styles.chartTablePlace}>
              <Text style={styles.fieldLabel}>{area.label}</Text>
              {area.detail !== '' && <Text style={styles.chartCount}>{area.detail}</Text>}
            </View>
            {area.sizes.map(({ median, count }, index) => (
              <View key={SIZES[index]} style={styles.chartCell}>
                <Text style={styles.chartPrice}>{median === null ? '—' : formatRent(Math.round(median))}</Text>
                <Text style={styles.chartCount}>{count === 0 ? ' ' : `n = ${count}`}</Text>
              </View>
            ))}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

/** The states the snapshot covers, and the region each one asks the server for. */
const STATES = [
  ['all', 'All', ''],
  ['nyc', 'New York', ', NY'],
  ['nj', 'New Jersey', ', NJ'],
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
  const [view, setView] = useState('trend');
  const [bedrooms, setBedrooms] = useState(1);
  const [pinned, setPinned] = useState<string[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loaded, setLoaded] = useState<Record<string, RentMarket | 'failed'>>({});
  const [historyArea, setHistoryArea] = useState<string | undefined>();

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
  const displayed =
    selected && choice.level === 'state' ? { ...selected, label: state === 'all' ? 'New York and New Jersey' : stateLabel } : selected;
  const pinnedAreas = pinned.map((id) => byId.get(id)).filter((area): area is RentArea => Boolean(area));
  const trend = dataset === 'market' && view === 'trend';
  // The table lists the level below the choice: cities in a state, neighborhoods in a city, ZIP codes for a ZIP.
  const tableAreas =
    choice.level === 'zip'
      ? (ready(zips)?.areas ?? []).filter(({ id }) => id !== 'overall')
      : choice.level === 'state'
        ? stateCities
        : cityNeighborhoods;
  const levelName = state === 'nyc' ? 'Borough' : state === 'nj' ? 'City' : 'Borough or city';

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

  if (dataset === 'dashboard')
    return (
      <View style={styles.marketplacePanel}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to rent trends"
          onPress={() => setDataset('market')}
          style={{ alignSelf: 'flex-start', paddingVertical: 6 }}
        >
          <Text style={styles.linkText}>← Back to rent trends</Text>
        </Pressable>
        <MarketHistory load={loadHistory} initialArea={historyArea} />
      </View>
    );

  const shownNeighborhoods = allNeighborhoods ? cityNeighborhoods : busiestNeighborhoods.slice(0, CHIP_LIMIT);
  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text style={styles.chartKicker}>MARKET DATA</Text>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          Rent trends
        </Text>
        <Text style={styles.bodyText}>Compare monthly asking rents for studios through four bedrooms.</Text>
      </View>
      <View style={styles.chipRow}>
        <Chip
          selected={dataset === 'market'}
          onPress={() => {
            setDataset('market');
            chooseState(state);
          }}
        >
          Market snapshot
        </Chip>
        <Chip
          selected={false}
          onPress={() => {
            setHistoryArea(undefined);
            setDataset('dashboard');
          }}
        >
          Market history 2010–2026
        </Chip>
        <Chip
          selected={dataset === 'saved'}
          onPress={() => {
            setDataset('saved');
            chooseState(state);
          }}
        >
          Saved listings
        </Chip>
      </View>
      <View style={styles.chartControls}>
        <Text style={styles.fieldLabel}>State</Text>
        <View style={styles.chipRow}>
          {STATES.map(([id, label]) => (
            <Chip key={id} selected={state === id} onPress={() => chooseState(id)}>
              {label}
            </Chip>
          ))}
        </View>
        {state === 'all' ? (
          <Text style={styles.smallMuted}>Choose New York or New Jersey to pick a borough or city, or select a row in the table.</Text>
        ) : (
          stateCities.length > 0 && (
            <>
              <Text style={styles.fieldLabel}>{levelName}</Text>
              <View style={styles.chipRow}>
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
                    {label.replace(/, (NY|NJ)$/, '')}
                  </Chip>
                ))}
              </View>
            </>
          )
        )}
        {cityId !== '' && cityNeighborhoods.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>Neighborhood</Text>
            <View style={styles.chipRow}>
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
            </View>
          </>
        )}
        <Field label="ZIP code" placeholder="e.g. 11215" value={zip} onChangeText={chooseZip} maxLength={5} keyboardType="number-pad" />
      </View>
      {displayed ? (
        <>
          {dataset === 'market' && (
            <View style={styles.chipRow}>
              <Chip selected={trend} onPress={() => setView('trend')}>
                Over time
              </Chip>
              <Chip selected={!trend} onPress={() => setView('sizes')}>
                By bedroom
              </Chip>
            </View>
          )}
          {trend ? (
            <View style={styles.chartCard}>
              <Text accessibilityRole="header" style={styles.fieldLabel}>
                Median asking rent over time: {displayed.label}
              </Text>
              <View style={styles.chipRow}>
                {SIZES.map((label, index) => (
                  <Chip key={label} selected={bedrooms === index} onPress={() => setBedrooms(index)}>
                    {label}
                  </Chip>
                ))}
              </View>
              <RentTrend
                areas={[displayed, ...pinnedAreas.filter(({ id }) => id !== displayed.id)]}
                bedrooms={bedrooms}
                month={month}
                history={history}
              />
              {dataset === 'market' &&
                loadHistory &&
                choice.level !== 'zip' &&
                // This snapshot starts in May 2026. StreetEasy's figures for the same neighborhood or borough go back
                // to 2010, though not by ZIP code or for New Jersey.
                (choice.level === 'state' ? state !== 'nj' : cityId.endsWith(', NY')) && (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => {
                      setHistoryArea(choice.level === 'state' ? 'NYC' : displayed.label.replace(/, NY$/, ''));
                      setDataset('dashboard');
                    }}
                  >
                    <Text style={styles.linkText}>
                      {choice.level === 'state' ? 'New York City' : displayed.label.replace(/, NY$/, '')} since 2010 (StreetEasy) →
                    </Text>
                  </Pressable>
                )}
              <View style={styles.chartCompare}>
                <Text style={styles.smallMuted}>Pin this area, then choose another to compare.</Text>
                <View style={styles.chipRow}>
                  {!pinned.includes(displayed.id) && pinned.length < 2 && (
                    <Chip onPress={() => setPinned([...pinned, displayed.id])}>+ Pin {displayed.label}</Chip>
                  )}
                  {pinnedAreas.map(({ id, label }) => (
                    <Chip key={id} selected onPress={() => setPinned(pinned.filter((item) => item !== id))}>
                      {label} ×
                    </Chip>
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <MedianBars area={displayed} />
          )}
          {tableAreas.length > 0 && (
            <>
              <View style={styles.chartIntro}>
                <Text accessibilityRole="header" style={styles.fieldLabel}>
                  {(dataset === 'market' ? formatSnapshotMonth(month) + ' medians' : 'Saved listing medians') +
                    (choice.level === 'state'
                      ? ` by ${levelName.toLowerCase()}`
                      : choice.level === 'zip'
                        ? ' by ZIP code'
                        : ' by neighborhood')}
                </Text>
                <Text style={styles.smallMuted}>Select a row to chart it. Each median includes its listing count.</Text>
              </View>
              <RentTable
                areas={tableAreas.slice(0, visible)}
                selection={choice.id}
                choose={(id) =>
                  choose(
                    choice.level === 'state'
                      ? { level: 'city', id }
                      : choice.level === 'zip'
                        ? { level: 'zip', id }
                        : { level: 'neighborhood', id },
                  )
                }
              />
              {visible < tableAreas.length && (
                <Button secondary onPress={() => setVisible(visible + PAGE_SIZE)}>
                  Show more areas ({visible} of {tableAreas.length})
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
            {choice.level === 'zip' ? `No listings in ${choice.id}` : 'No rent observations here'}
          </Text>
          <Text style={styles.bodyText}>
            {choice.level === 'zip'
              ? 'This snapshot has no asking rents in that ZIP code. Try a nearby one, or choose a borough or neighborhood.'
              : dataset === 'market'
                ? 'The public snapshot has no observations for this selection.'
                : 'Save listings in this area to compare their asking rents.'}
          </Text>
          {dataset === 'saved' && (
            <Button secondary onPress={showSaved}>
              Open saved listings
            </Button>
          )}
        </View>
      )}
      <View style={styles.chartSource}>
        {dataset === 'market' ? (
          <>
            <Text style={styles.fieldLabel}>About this data</Text>
            <Text style={styles.smallMuted}>
              Median initial asking rents from FirstMover's monthly snapshot of new listings in the five boroughs and nearby New Jersey
              cities, starting May 2026. For the years before, use Market history.
            </Text>
            <Link label="View source data" url={SNAPSHOT_SOURCE} onError={onError} />
          </>
        ) : (
          <Text style={styles.smallMuted}>Asking rents and dates from the listings you saved on this device.</Text>
        )}
      </View>
    </View>
  );
}
