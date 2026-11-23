/**
 * Market history: StreetEasy's monthly Data Dashboard figures since 2010, read from the server's market
 * history tables. One row of filters scopes every chart below it: market, area, bedrooms (or property type),
 * measure and time range.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SERIES_COLORS } from '../chart-colors.ts';
import { ChartCard } from '../components/ChartParts.tsx';
import { LineChart } from '../components/LineChart.tsx';
import { RankedBars, ScatterChart, SeasonColumns, StatTile, YearHeatmap } from '../components/MarketCharts.tsx';
import { Chip, Field, Link } from '../components/ui.tsx';
import { DASHBOARD_URL, dashboardSegmentLabel, type METRICS } from '../dashboard-data.ts';
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

export function MarketHistory({ load }: { load?: LoadHistory }) {
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
  const headline = focusSeries ? latest(allMonths, primary, unit) : null;
  const ranked = useMemo(() => {
    if (!focusMonth.data || !focusSeries) return [];
    const rows = ranking(focusMonth.data, areas, unit, rankingBorough, rankBy === 'highest' || rankBy === 'lowest' ? 'value' : 'change');
    return rankBy === 'lowest' || rankBy === 'fall' ? rows.reverse() : rows;
  }, [focusMonth.data, focusSeries, areas, rankingBorough, rankBy]);
  const position = ranked.findIndex(({ id }) => id === areaId);
  const peers = focusMonth.data && focusSeries ? ranking(focusMonth.data, areas, unit, borough, 'value') : [];
  const peerRank = peers.findIndex(({ id }) => id === areaId);

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

  if (!load)
    return (
      <View style={styles.chartCard}>
        <Text style={styles.smallMuted}>
          Market history is unavailable on this server. Connect to a server with dashboard access; a private server requires authentication.
        </Text>
      </View>
    );

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.chartIntro}>
        <Text style={styles.chartKicker}>STREETEASY DATA DASHBOARD · 2010–{latestMonth.slice(0, 4)}</Text>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          Market history
        </Text>
        <Text style={styles.bodyText}>
          Every monthly figure in StreetEasy’s Data Dashboard export: rents, inventory and price cuts for the city, its boroughs and{' '}
          {areas.filter(({ type }) => type === 'neighborhood').length || 176} neighborhoods, plus the sales market. Market-wide figures, not
          individual listings.
        </Text>
        <Text style={styles.smallMuted}>
          Through {monthLabel(latestMonth)}; downloaded {data?.provenance.downloadedAt ?? '2026-11-17'}. Blank months are unknown, never
          zero.
        </Text>
        <Link label="StreetEasy Data Dashboard (source and methodology)" url={DASHBOARD_URL} />
      </View>
      {catalog.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          The market history catalog could not be loaded. Try again shortly.
        </Text>
      )}

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
            <AreaPicker
              label={`Area: ${area?.name ?? 'NYC'}${area?.type === 'neighborhood' ? ` (${area.borough})` : ''}`}
              areas={areas}
              exclude={[areaId]}
              onPick={(picked) => {
                setAreaId(picked.id);
                setCompare((current) => current.filter((id) => id !== picked.id));
                setRankBorough(null);
              }}
            />
            {compare.length < 3 && (
              <AreaPicker
                label="Compare with"
                areas={areas}
                exclude={shown}
                onPick={(picked) => setCompare((current) => [...current, picked.id].slice(0, 3))}
              />
            )}
          </View>
          {compare.length > 0 && (
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
          <Text style={styles.fieldLabel}>{market === 'Rentals' ? 'Bedrooms' : 'Property type'}</Text>
          <View style={styles.chipRow}>
            {config.segments.map((item) => (
              <Chip key={item} selected={segment === item} onPress={() => setSegment(item)}>
                {dashboardSegmentLabel(item)}
              </Chip>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Measure</Text>
          <View style={styles.chipRow}>
            {[...new Set(data.series.filter((item) => item.market === market).map(({ metric }) => metric))].map((metric) => (
              <Chip key={metric} selected={focus === metric} onPress={() => setFocus(metric)}>
                {data.series.find((item) => item.metric === metric)!.label}
              </Chip>
            ))}
          </View>
          <Text style={styles.fieldLabel}>Time range</Text>
          <View style={styles.chipRow}>
            {RANGES.map(([count, label]) => (
              <Chip key={count} selected={months === count} onPress={() => setMonths(count)}>
                {label}
              </Chip>
            ))}
          </View>
        </View>
      )}

      {values.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          These figures could not be loaded. No values have been substituted; try again shortly.
        </Text>
      )}

      {headline && focusSeries && area && (
        <View accessibilityRole="summary" style={[styles.chartCard, { gap: 6 }]}>
          <Text style={{ fontSize: 17, lineHeight: 25, color: '#0b0b0b' }}>
            {focusSeries.label}
            {focusSeries.segment !== 'All' ? ` (${dashboardSegmentLabel(focusSeries.segment).toLowerCase()})` : ''} in {area.name} was{' '}
            <Text style={{ fontWeight: '800' }}>{format(headline.value)}</Text> in {monthLabel(headline.month)}
            {headline.yearly !== null ? `, ${formatChange(headline.yearly, unit)} from a year earlier` : ''}
            {peerRank >= 0 && peers.length > 1
              ? `. That is higher than ${peers.length - 1 - peerRank} of ${peers.length - 1} other ${borough} neighborhoods.`
              : '.'}
          </Text>
        </View>
      )}

      {values.data && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, opacity: values.busy ? 0.55 : 1 }}>
          {tileSeries.map((item) => {
            const series = values.data!.values[item.name]?.[areaId] ?? [];
            const now = latest(values.data!.months, series, item.unit);
            if (!now) return null;
            return (
              <StatTile
                key={item.name}
                label={item.label}
                value={formatValue(now.value, item.unit, true)}
                delta={formatChange(now.yearly, item.unit)}
                period={`vs ${monthLabel(shiftMonth(now.month, -12))}`}
                values={series.slice(-24)}
              />
            );
          })}
        </View>
      )}

      {trend && focusSeries && (
        <ChartCard
          busy={values.busy}
          title={`${focusSeries.label}${focusSeries.segment !== 'All' ? ` · ${dashboardSegmentLabel(focusSeries.segment)}` : ''}, ${start.slice(0, 4)}–${latestMonth.slice(0, 4)}`}
          subtitle={
            indexedView
              ? `Percent change since ${monthLabel(trend.months[0] ?? start)}, so areas of any size compare.`
              : 'Monthly values. Add areas to compare above; hover or touch the chart to read a month.'
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

      {bySegment.data && focusSeries && segmentNames.length > 0 && (
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

      {grid.rows.length > 0 && focusSeries && (
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

      {seasons.some(({ value }) => value !== null) && focusSeries && (
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

      {focusSeries && focusMonth.data && (
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
          <RankedBars
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

      {scatter.length > 0 && (
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
    </View>
  );
}
