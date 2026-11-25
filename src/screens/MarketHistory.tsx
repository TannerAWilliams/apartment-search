/**
 * Market history: StreetEasy's monthly Data Dashboard figures since 2010, read from the server's market
 * history tables. One row of filters scopes every chart below it: market, area, bedrooms (or property type),
 * measure and time range.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type Insight, InsightCards } from '../components/InsightCards.tsx';
import { Pressable, Text, View } from 'react-native';
import { SERIES_COLORS } from '../chart-colors.ts';
import { ChartCard } from '../components/ChartParts.tsx';
import { LineChart } from '../components/LineChart.tsx';
import { RankedList, ScatterChart, SeasonColumns, YearHeatmap } from '../components/MarketCharts.tsx';
import { Chip, Field } from '../components/ui.tsx';
import { dashboardSegmentLabel, type METRICS } from '../dashboard-data.ts';
import {
  change,
  formatChange,
  formatValue,
  type HistoryArea,
  type HistoryCatalog,
  type HistoryMonth,
  type HistorySeries,
  type HistoryValues,
  indexed,
  latest,
  monthLabel,
  ranking,
  scatterPoints,
  seasonality,
  shiftMonth,
  yearOverYearGrid,
} from '../market-history.ts';
import { styles } from '../styles.ts';

export type LoadHistory = <T>(path: string, signal: AbortSignal) => Promise<T>;
type Metric = keyof typeof METRICS;
type Market = 'Rentals' | 'Sales';

/** What each market's tiles and comparisons use. */
const MARKETS: Record<Market, { price: Metric; volume: Metric; cuts: Metric; extra: Metric; segments: string[] }> = {
  Rentals: {
    price: 'medianAskingRent',
    volume: 'rentalInventory',
    cuts: 'discountShare',
    extra: 'rentalIndex',
    segments: ['All', 'Studio', 'OneBd', 'TwoBd', 'ThreePlusBd'],
  },
  Sales: {
    price: 'medianAskingPrice',
    volume: 'totalInventory',
    cuts: 'priceCutShare',
    extra: 'daysOnMarket',
    segments: ['All', 'Coop', 'Condo', 'Sfr'],
  },
};
const RANGES = [
  [12, '1 year'],
  [36, '3 years'],
  [60, '5 years'],
  [120, '10 years'],
  [0, 'Since 2010'],
] as const;
const FIRST_MONTH = '2010-01';

/** One request's result, kept on screen (dimmed) while the next one loads. */
function useHistory<T>(load: LoadHistory | undefined, path: string | null) {
  const [state, setState] = useState<{ path: string; data: T | null; error: boolean }>({ path: '', data: null, error: false });
  useEffect(() => {
    if (!load || !path) return;
    const controller = new AbortController();
    load<T>(path, controller.signal)
      .then((data) => !controller.signal.aborted && setState({ path, data, error: false }))
      .catch(() => !controller.signal.aborted && setState((previous) => ({ ...previous, path, error: true })));
    return () => controller.abort();
  }, [load, path]);
  return { data: state.data, busy: Boolean(path) && state.path !== path, error: state.path === path && state.error };
}

function AreaPicker({
  label,
  areas,
  onPick,
  exclude = [],
}: {
  label: string;
  areas: HistoryArea[];
  onPick: (area: HistoryArea) => void;
  exclude?: number[];
}) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const matches = search
    ? areas.filter((area) => !exclude.includes(area.id) && `${area.name} ${area.borough}`.toLowerCase().includes(search)).slice(0, 8)
    : [];
  return (
    <View style={{ gap: 6, flexGrow: 1, flexBasis: 220 }}>
      <Field label={label} value={query} onChangeText={setQuery} placeholder="Neighborhood or borough" maxLength={60} />
      {matches.length > 0 && (
        <View style={styles.chipRow}>
          {matches.map((area) => (
            <Chip
              key={area.id}
              onPress={() => {
                onPick(area);
                setQuery('');
              }}
            >
              {area.name}
              {area.type === 'neighborhood' ? ` · ${area.borough}` : ''}
            </Chip>
          ))}
        </View>
      )}
      {search !== '' && matches.length === 0 && <Text style={styles.smallMuted}>No StreetEasy area matches “{query.trim()}”.</Text>}
    </View>
  );
}

/** What StreetEasy's rent and price indexes are, in words. */
const INDEX_NOTE =
  'StreetEasy’s index follows the same apartments over time, so it shows how rents really moved, not which apartments happened to be listed. Shown in dollars at today’s level; it covers New York City, Manhattan, Brooklyn and Queens.';

/** StreetEasy's cards, and the chart each opens. */
const CARD_VIEWS = {
  cuts: 'trend',
  inventory: 'trend',
  extra: 'trend',
  year: 'year',
  seasons: 'seasons',
  rank: 'rank',
  temperature: 'temperature',
  sizes: 'sizes',
} as const;
type ChartView = (typeof CARD_VIEWS)[keyof typeof CARD_VIEWS];
/** The page's sizes (studio to 4 bedrooms) as StreetEasy's bedroom segments. */
const SIZE_SEGMENTS = ['Studio', 'OneBd', 'TwoBd', 'ThreePlusBd', 'ThreePlusBd'];
const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * StreetEasy's figures for the Market page's area and size, as answer cards beside the page's own (`lead`), with
 * the open card's chart under them. `area` is a borough or neighborhood by name; StreetEasy covers New York City
 * only, so elsewhere only the page's own cards show.
 */
export function MarketHistory({
  load,
  area: chosenArea,
  bedrooms,
  lead,
  leadDetail,
  selected,
  onSelect,
}: {
  load?: LoadHistory;
  area: string;
  bedrooms: number;
  lead: Insight[];
  /** The chart for the open card when it is one of `lead`. */
  leadDetail: ReactNode;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const catalog = useHistory<HistoryCatalog>(load, 'history');
  const [market, setMarket] = useState<Market>('Rentals');
  const [segment, setSegment] = useState('All');
  const [focus, setFocus] = useState<Metric>('medianAskingRent');
  const [areaId, setAreaId] = useState(1);
  const [compare, setCompare] = useState<number[]>([]);
  const [months, setMonths] = useState<number>(60);
  const [indexedView, setIndexedView] = useState(false);
  const [rankBorough, setRankBorough] = useState<string | null>(null);
  const [rankBy, setRankBy] = useState<'highest' | 'lowest' | 'rise' | 'fall'>('highest');
  const [showAll, setShowAll] = useState(false);

  const data = catalog.data;
  const areas = data?.areas ?? [];
  const wanted = chosenArea.trim().toLowerCase();
  const match = areas.find(({ name }) => name.toLowerCase() === wanted);
  useEffect(() => {
    if (match) setAreaId(match.id);
    setRankBorough(null);
  }, [match]);
  // The page's size picks StreetEasy's bedroom segment; the chart's own chips can change it after.
  useEffect(() => {
    if (market === 'Rentals') setSegment(SIZE_SEGMENTS[bedrooms] ?? 'All');
    // biome-ignore lint/correctness/useExhaustiveDependencies: only when the page's size changes
  }, [bedrooms]);
  const area = areas.find(({ id }) => id === areaId);
  const latestMonth = data?.latestMonth ?? '2026-10';
  const config = MARKETS[market];
  const seriesFor = (metric: Metric, wanted = segment) =>
    data?.series.find((item) => item.metric === metric && item.segment === wanted) ??
    data?.series.find((item) => item.metric === metric && item.segment === 'All');
  const focusSeries = seriesFor(focus);
  const tileSeries = [seriesFor(config.price), seriesFor(config.volume), seriesFor(config.cuts), seriesFor(config.extra)].filter(
    (item): item is HistorySeries => Boolean(item),
  );
  const shown = [areaId, ...compare];
  const borough = area?.type === 'neighborhood' ? area.borough : area?.type === 'borough' ? area.name : '';
  const rankingBorough = rankBorough ?? borough;

  // Requests: the shown areas' series, the focus measure by segment, and every area in the latest month.
  const mainNames = [...new Set([focusSeries?.name, ...tileSeries.map(({ name }) => name)].filter(Boolean))].slice(0, 6);
  const values = useHistory<HistoryValues>(
    load,
    data && mainNames.length
      ? `history/values?series=${mainNames.join(',')}&areas=${shown.join(',')}&from=${FIRST_MONTH}&to=${latestMonth}`
      : null,
  );
  const segmentNames = data ? data.series.filter((item) => item.metric === focus && item.segment !== 'All').map(({ name }) => name) : [];
  const bySegment = useHistory<HistoryValues>(
    load,
    segmentNames.length ? `history/values?series=${segmentNames.join(',')}&areas=${areaId}&from=${FIRST_MONTH}&to=${latestMonth}` : null,
  );
  const monthPath = (item: HistorySeries | undefined) => (item ? `history/month?series=${item.name}&month=${latestMonth}` : null);
  const focusMonth = useHistory<HistoryMonth>(load, monthPath(focusSeries));
  const priceMonth = useHistory<HistoryMonth>(load, monthPath(seriesFor(config.price)));
  const cutsMonth = useHistory<HistoryMonth>(load, monthPath(seriesFor(config.cuts)));

  const unit = focusSeries?.unit ?? 'USD';
  const format = (value: number) => formatValue(value, unit);
  const formatAxis = (value: number) => formatValue(value, unit, true);
  const start = months ? shiftMonth(latestMonth, 1 - months) : FIRST_MONTH;
  const areaName = (id: number) => areas.find((item) => item.id === id)?.name ?? 'Area';

  const trend = useMemo(() => {
    const result = values.data;
    if (!result || !focusSeries) return null;
    const from = Math.max(0, result.months.indexOf(start));
    return {
      months: result.months.slice(from),
      series: shown
        .map((id, index) => {
          const raw = result.values[focusSeries.name]?.[id]?.slice(from) ?? [];
          return { key: String(id), label: areaName(id), color: SERIES_COLORS[index]!, values: indexedView ? indexed(raw) : raw };
        })
        .filter((item) => item.values.some((value) => value !== null)),
    };
  }, [values.data, focusSeries, start, shown.join(), indexedView, areas]);

  const primary = values.data && focusSeries ? (values.data.values[focusSeries.name]?.[areaId] ?? []) : [];
  const allMonths = values.data?.months ?? [];
  const ranked = useMemo(() => {
    if (!focusMonth.data || !focusSeries) return [];
    const rows = ranking(focusMonth.data, areas, unit, rankingBorough, rankBy === 'highest' || rankBy === 'lowest' ? 'value' : 'change');
    return rankBy === 'lowest' || rankBy === 'fall' ? rows.reverse() : rows;
  }, [focusMonth.data, focusSeries, areas, rankingBorough, rankBy]);
  const position = ranked.findIndex(({ id }) => id === areaId);

  const grid = yearOverYearGrid(allMonths, primary, unit);
  const seasons = seasonality(allMonths, primary);
  const scatter =
    priceMonth.data && cutsMonth.data
      ? scatterPoints(
          priceMonth.data,
          cutsMonth.data,
          areas,
          (row) => change(row.value, row.yearAgo, 'USD'),
          (row) => row.value,
        )
      : [];

  // The answer cards: each one figure for the area and size, from the same requests the charts use.
  const valuesOf = (item: HistorySeries | undefined) => (item && values.data ? (values.data.values[item.name]?.[areaId] ?? []) : []);
  const now = (item: HistorySeries | undefined) => (item ? latest(allMonths, valuesOf(item), item.unit) : null);
  const priceSeries = seriesFor(config.price);
  const cutsSeries = seriesFor(config.cuts);
  const volumeSeries = seriesFor(config.volume);
  const extraSeries = seriesFor(config.extra);
  const price = now(priceSeries);
  const cuts = now(cutsSeries);
  const volume = now(volumeSeries);
  const extra = now(extraSeries);
  const priceSeasons = seasonality(allMonths, valuesOf(priceSeries));
  const best = priceSeasons
    .map((season, index) => ({ ...season, index }))
    .filter((season): season is typeof season & { value: number } => season.value !== null)
    .sort((a, b) => a.value - b.value)[0];
  const priceRanked = priceMonth.data ? ranking(priceMonth.data, areas, 'USD', borough, 'value') : [];
  const pricePosition = priceRanked.findIndex(({ id }) => id === areaId);
  const sizeLatest = segmentNames
    .map((name) => bySegment.data && latest(bySegment.data.months, bySegment.data.values[name]?.[areaId] ?? [], unit))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map(({ value }) => value);
  const heat =
    price?.yearly == null || cuts?.yearly == null
      ? null
      : price.yearly > 0 && cuts.yearly <= 0
        ? 'Heating up'
        : price.yearly < 0 && cuts.yearly >= 0
          ? 'Cooling'
          : 'Mixed';
  const rentals = market === 'Rentals';
  const own: Insight[] =
    match && values.data
      ? [
          ...(cuts && cutsSeries
            ? [
                {
                  key: 'cuts',
                  question: 'Listings with a price cut',
                  answer: formatValue(cuts.value, cutsSeries.unit),
                  context: `${formatChange(cuts.yearly, cutsSeries.unit)} in a year · bargaining room`,
                },
              ]
            : []),
          ...(volume && volumeSeries
            ? [
                {
                  key: 'inventory',
                  question: rentals ? 'Apartments for rent' : volumeSeries.label,
                  answer: formatValue(volume.value, volumeSeries.unit, true),
                  context: `${formatChange(volume.yearly, volumeSeries.unit)} in a year · more means more choice`,
                },
              ]
            : []),
          ...(price?.yearly != null
            ? [
                {
                  key: 'year',
                  question: rentals ? 'Rent change in a year' : 'Price change in a year',
                  answer: formatChange(price.yearly, 'USD'),
                  context: `${monthLabel(price.month)}, every month since 2010 inside`,
                },
              ]
            : []),
          ...(best
            ? [
                {
                  key: 'seasons',
                  question: 'Cheapest month',
                  answer: FULL_MONTHS[best.index]!,
                  context: `To ${rentals ? 'sign a lease' : 'buy'}: ${formatChange(best.value, 'USD')} vs the year’s average`,
                },
              ]
            : []),
          ...(priceRanked.length > 1
            ? [
                {
                  key: 'rank',
                  question: pricePosition >= 0 ? `Rank in ${borough}` : `${borough || 'NYC'} neighborhoods`,
                  answer: pricePosition >= 0 ? `#${pricePosition + 1} of ${priceRanked.length}` : `${priceRanked.length} ranked`,
                  context: pricePosition >= 0 ? 'Most expensive first' : 'By median asking rent and change',
                },
              ]
            : []),
          ...(heat ? [{ key: 'temperature', question: 'Market', answer: heat, context: 'Price changes against price cuts' }] : []),
          ...(sizeLatest.length > 1 && focusSeries
            ? [
                {
                  key: 'sizes',
                  question: 'By size',
                  answer: `${formatValue(Math.min(...sizeLatest), unit, true)}–${formatValue(Math.max(...sizeLatest), unit, true)}`,
                  context: `${focusSeries.label}, smallest to largest`,
                },
              ]
            : []),
          ...(extra && extraSeries
            ? [
                {
                  key: 'extra',
                  question: extraSeries.label,
                  answer: formatValue(extra.value, extraSeries.unit, true),
                  context: `${formatChange(extra.yearly, extraSeries.unit)} in a year${extraSeries.metric.endsWith('Index') ? ' · the same homes over time, all sizes' : ''}`,
                },
              ]
            : []),
        ]
      : [];
  const note = !load
    ? undefined
    : catalog.error
      ? 'StreetEasy’s figures could not be loaded. Try again shortly.'
      : !data || (match && !values.data && !values.error)
        ? 'Loading StreetEasy’s figures…'
        : !match
          ? `Price cuts, inventory, rankings and the best month to sign come from StreetEasy, which covers New York City only.`
          : undefined;
  // A card that is gone (another area, still loading) falls back to the first.
  const current = [...lead, ...own].some(({ key }) => key === selected) ? selected : (lead[0]?.key ?? '');
  const view: ChartView | null = current in CARD_VIEWS ? CARD_VIEWS[current as keyof typeof CARD_VIEWS] : null;
  /** Opens a card; the measure cards set the chart's measure to theirs. */
  function select(key: string) {
    if (key === 'cuts') setFocus(config.cuts);
    else if (key === 'inventory') setFocus(config.volume);
    else if (key === 'extra') setFocus(config.extra);
    else if (key in CARD_VIEWS) setFocus(config.price);
    onSelect(key);
  }

  return (
    <InsightCards insights={[...lead, ...own]} selected={current} onSelect={select} note={note}>
      {view === null ? (
        leadDetail
      ) : (
        <View style={{ gap: 14 }}>
          {data && (
            <View style={[styles.chartCard, { gap: 10 }]}>
              <View style={styles.chipRow}>
                {(['Rentals', 'Sales'] as const).map((item) => (
                  <Chip
                    key={item}
                    selected={market === item}
                    onPress={() => {
                      setMarket(item);
                      setSegment('All');
                      setFocus(MARKETS[item].price);
                    }}
                  >
                    {item}
                  </Chip>
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {view === 'trend' && compare.length < 3 && (
                  <AreaPicker
                    label="Compare with"
                    areas={areas}
                    exclude={shown}
                    onPick={(picked) => setCompare((current) => [...current, picked.id].slice(0, 3))}
                  />
                )}
              </View>
              {view === 'trend' && compare.length > 0 && (
                <View style={styles.chipRow}>
                  {compare.map((id) => (
                    <Chip
                      key={id}
                      label={`Stop comparing ${areaName(id)}`}
                      onPress={() => setCompare((current) => current.filter((item) => item !== id))}
                    >
                      {areaName(id)} ✕
                    </Chip>
                  ))}
                </View>
              )}
              {view !== 'sizes' && view !== 'temperature' && (
                <>
                  <Text style={styles.fieldLabel}>{market === 'Rentals' ? 'Bedrooms' : 'Property type'}</Text>
                  <View style={styles.chipRow}>
                    {config.segments.map((item) => (
                      <Chip key={item} selected={segment === item} onPress={() => setSegment(item)}>
                        {dashboardSegmentLabel(item)}
                      </Chip>
                    ))}
                  </View>
                </>
              )}
              {view !== 'temperature' && <Text style={styles.fieldLabel}>Measure</Text>}
              {view !== 'temperature' && (
                <View style={styles.chipRow}>
                  {[...new Set(data.series.filter((item) => item.market === market).map(({ metric }) => metric))].map((metric) => (
                    <Chip key={metric} selected={focus === metric} onPress={() => setFocus(metric)}>
                      {data.series.find((item) => item.metric === metric)!.label}
                    </Chip>
                  ))}
                </View>
              )}
              {(view === 'trend' || view === 'sizes') && (
                <>
                  <Text style={styles.fieldLabel}>Time range</Text>
                  <View style={styles.chipRow}>
                    {RANGES.map(([count, label]) => (
                      <Chip key={count} selected={months === count} onPress={() => setMonths(count)}>
                        {label}
                      </Chip>
                    ))}
                  </View>
                </>
              )}
            </View>
          )}

          {values.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              These figures could not be loaded. No values have been substituted; try again shortly.
            </Text>
          )}

          {view === 'trend' && trend && focusSeries && trend.series.length === 0 && !values.busy && (
            <Text style={styles.smallMuted}>
              StreetEasy publishes no {focusSeries.label.toLowerCase()} for {area?.name ?? 'this area'}
              {focusSeries.metric.endsWith('Index') ? '; it does for New York City, Manhattan, Brooklyn and Queens only.' : '.'}
            </Text>
          )}
          {view === 'trend' && trend && focusSeries && trend.series.length > 0 && (
            <ChartCard
              busy={values.busy}
              title={`${focusSeries.label}${focusSeries.segment !== 'All' ? ` · ${dashboardSegmentLabel(focusSeries.segment)}` : ''}, ${start.slice(0, 4)}–${latestMonth.slice(0, 4)}`}
              subtitle={
                (focusSeries.metric.endsWith('Index') ? `${INDEX_NOTE} ` : '') +
                (indexedView
                  ? `Percent change since ${monthLabel(trend.months[0] ?? start)}, so areas of any size compare.`
                  : 'Monthly values. Add areas to compare above; hover or touch the chart to read a month.')
              }
              legend={trend.series.map(({ label, color }) => ({ label, color }))}
              table={{
                columns: ['Month', ...trend.series.map(({ label }) => label)],
                rows: trend.months
                  .map((month, index) => [
                    monthLabel(month),
                    ...trend.series.map(({ values: line }) =>
                      line[index] === null || line[index] === undefined
                        ? '—'
                        : indexedView
                          ? formatChange(line[index]!, 'USD')
                          : format(line[index]!),
                    ),
                  ])
                  .reverse(),
              }}
            >
              <View style={styles.chipRow}>
                <Chip selected={!indexedView} onPress={() => setIndexedView(false)}>
                  Values
                </Chip>
                <Chip selected={indexedView} onPress={() => setIndexedView(true)}>
                  % change since {start.slice(0, 4)}
                </Chip>
              </View>
              <LineChart
                months={trend.months}
                series={trend.series}
                format={indexedView ? (value) => formatChange(value, 'USD') : format}
                formatAxis={indexedView ? (value) => formatChange(value, 'USD') : formatAxis}
                zeroBased={!indexedView && (unit === 'count' || unit === 'share')}
              />
            </ChartCard>
          )}

          {view === 'sizes' && bySegment.data && focusSeries && segmentNames.length > 0 && (
            <ChartCard
              busy={bySegment.busy}
              title={`${focusSeries.label} by ${market === 'Rentals' ? 'apartment size' : 'property type'} in ${area?.name ?? 'NYC'}`}
              subtitle="Each line is one size of apartment, over the same time range."
              legend={segmentNames.map((name, index) => ({
                label: dashboardSegmentLabel(data?.series.find((item) => item.name === name)?.segment ?? ''),
                color: SERIES_COLORS[index]!,
              }))}
              table={{
                columns: [
                  'Month',
                  ...segmentNames.map((name) => dashboardSegmentLabel(data?.series.find((item) => item.name === name)?.segment ?? '')),
                ],
                rows: bySegment.data.months
                  .slice(Math.max(0, bySegment.data.months.indexOf(start)))
                  .map((month) => [
                    monthLabel(month),
                    ...segmentNames.map((name) => {
                      const value = bySegment.data!.values[name]?.[areaId]?.[bySegment.data!.months.indexOf(month)];
                      return value === null || value === undefined ? '—' : format(value);
                    }),
                  ])
                  .reverse(),
              }}
            >
              <LineChart
                months={bySegment.data.months.slice(Math.max(0, bySegment.data.months.indexOf(start)))}
                series={segmentNames.map((name, index) => ({
                  key: name,
                  label: dashboardSegmentLabel(data?.series.find((item) => item.name === name)?.segment ?? ''),
                  color: SERIES_COLORS[index]!,
                  values: bySegment.data!.values[name]?.[areaId]?.slice(Math.max(0, bySegment.data!.months.indexOf(start))) ?? [],
                }))}
                format={format}
                formatAxis={formatAxis}
                zeroBased={unit === 'count' || unit === 'share'}
              />
            </ChartCard>
          )}

          {view === 'year' && grid.rows.length > 0 && focusSeries && (
            <ChartCard
              busy={values.busy}
              title={`Year-over-year change, every month since ${grid.rows.at(-1)?.year}`}
              subtitle={`${focusSeries.label} in ${area?.name}, compared with the same month a year earlier. Red is higher, blue is lower.`}
              table={{
                columns: ['Year', ...['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']],
                rows: grid.rows.map((row) => [row.year, ...row.cells.map((cell) => formatChange(cell.value, unit))]),
              }}
            >
              <YearHeatmap rows={grid.rows} extent={grid.extent} formatChange={(value) => formatChange(value, unit)} />
            </ChartCard>
          )}

          {view === 'seasons' && seasons.some(({ value }) => value !== null) && focusSeries && (
            <ChartCard
              busy={values.busy}
              title="Seasonality: how each month compares with its year"
              subtitle={`${focusSeries.label} in ${area?.name}, each month against its year’s average, averaged over ${Math.max(...seasons.map(({ years }) => years))} complete years.`}
              table={{
                columns: ['Month', 'vs year’s average', 'Years'],
                rows: seasons.map(({ name, value, years }) => [name, formatChange(value, 'USD'), years]),
              }}
            >
              <SeasonColumns months={seasons} formatChange={(value) => formatChange(value, 'USD')} />
            </ChartCard>
          )}

          {view === 'rank' && focusSeries && focusMonth.data && (
            <ChartCard
              busy={focusMonth.busy}
              title={`Neighborhoods ranked: ${focusSeries.label.toLowerCase()}, ${monthLabel(latestMonth)}`}
              subtitle={
                position >= 0
                  ? `${area?.name} is number ${position + 1} of ${ranked.length}${rankingBorough ? ` in ${rankingBorough}` : ''}, highlighted.`
                  : `${ranked.length} neighborhoods with a figure this month${rankingBorough ? ` in ${rankingBorough}` : ''}.`
              }
              table={{
                columns: ['Rank', 'Neighborhood', 'Value', 'vs a year earlier'],
                rows: ranked.map((row, index) => [
                  index + 1,
                  `${row.name} (${row.borough})`,
                  format(row.value),
                  formatChange(row.change, unit),
                ]),
              }}
            >
              <View style={styles.chipRow}>
                {['', 'Manhattan', 'Brooklyn', 'Queens', 'Bronx'].map((item) => (
                  <Chip key={item || 'all'} selected={rankingBorough === item} onPress={() => setRankBorough(item)}>
                    {item || 'All boroughs'}
                  </Chip>
                ))}
              </View>
              <View style={styles.chipRow}>
                {(
                  [
                    ['highest', 'Highest'],
                    ['lowest', 'Lowest'],
                    ['rise', 'Biggest rise'],
                    ['fall', 'Biggest fall'],
                  ] as const
                ).map(([key, label]) => (
                  <Chip key={key} selected={rankBy === key} onPress={() => setRankBy(key)}>
                    {label}
                  </Chip>
                ))}
              </View>
              <RankedList
                rows={showAll ? ranked : ranked.slice(0, 15)}
                highlight={areaId}
                mode={rankBy === 'highest' || rankBy === 'lowest' ? 'value' : 'change'}
                format={format}
                formatChange={(value) => formatChange(value, unit)}
              />
              {ranked.length > 15 && (
                <Pressable accessibilityRole="button" onPress={() => setShowAll(!showAll)}>
                  <Text style={styles.fieldLabel}>{showAll ? 'Show the top 15' : `Show all ${ranked.length}`}</Text>
                </Pressable>
              )}
            </ChartCard>
          )}

          {view === 'temperature' && scatter.length > 0 && (
            <ChartCard
              busy={priceMonth.busy || cutsMonth.busy}
              title={`Market temperature, ${monthLabel(latestMonth)}`}
              subtitle={`Each dot is a neighborhood. Right: ${market === 'Rentals' ? 'rents' : 'prices'} rising; up: more listings cutting their price. Bottom right is heating up, top left cooling down. ${borough ? `${borough} in blue, ` : ''}${area?.name} in orange.`}
              legend={[
                ...(area?.type === 'neighborhood' ? [{ label: area.name, color: SERIES_COLORS[1], shape: 'dot' as const }] : []),
                ...(borough ? [{ label: `Other ${borough} neighborhoods`, color: SERIES_COLORS[0], shape: 'dot' as const }] : []),
                ...(borough ? [{ label: 'Other neighborhoods', color: '#c9c8c1', shape: 'dot' as const }] : []),
              ]}
              table={{
                columns: ['Neighborhood', `${seriesFor(config.price)?.label} vs a year earlier`, seriesFor(config.cuts)?.label ?? ''],
                rows: [...scatter]
                  .sort((a, b) => b.x - a.x)
                  .map((point) => [`${point.name} (${point.borough})`, formatChange(point.x, 'USD'), formatValue(point.y, 'share')]),
              }}
            >
              <ScatterChart
                points={scatter}
                highlight={areaId}
                borough={borough}
                xLabel={`${seriesFor(config.price)?.label}, change from a year earlier`}
                yLabel={seriesFor(config.cuts)?.label ?? ''}
                formatX={(value) => formatChange(value, 'USD')}
                formatY={(value) => formatValue(value, 'share')}
                quadrants={{ heating: 'Heating up: rising, few cuts →', cooling: '← Cooling: falling, many cuts' }}
              />
            </ChartCard>
          )}
          <Text style={styles.smallMuted}>
            StreetEasy Data Dashboard, {area?.name}, through {monthLabel(latestMonth)}. Market-wide figures; blank months are unknown, never
            zero.
          </Text>
        </View>
      )}
    </InsightCards>
  );
}
