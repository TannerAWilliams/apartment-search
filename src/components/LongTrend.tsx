/**
 * Median asking rent over years, from StreetEasy's Data Dashboard (server/routes/history.ts): New York City, its
 * boroughs and neighborhoods, by size, since 2010. Used by the Market page when the time range is longer than the
 * monthly snapshot covers.
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SERIES_COLORS } from '../chart-colors.ts';
import { formatValue, type HistoryCatalog, type HistoryValues, shiftMonth } from '../market-history.ts';
import type { LoadHistory } from '../screens/MarketHistory.tsx';
import { styles } from '../styles.ts';
import { LineChart } from './LineChart.tsx';

/** StreetEasy's bedroom segments: studios, one, two, and three or more. */
const SEGMENTS = ['Studio', 'OneBd', 'TwoBd', 'ThreePlusBd', 'ThreePlusBd'];

let catalogs = new WeakMap<LoadHistory, Promise<HistoryCatalog>>();
/** The catalog once per loader, so changing the range or size does not fetch it again. */
function catalog(load: LoadHistory) {
  const cached = catalogs.get(load);
  if (cached) return cached;
  const request = load<HistoryCatalog>('history', new AbortController().signal);
  catalogs.set(load, request);
  request.catch(() => catalogs.delete(load));
  return request;
}
/** Forgets loaded catalogs (for tests). */
export const resetLongTrend = () => {
  catalogs = new WeakMap();
};

/** The StreetEasy area for an area name, or null when StreetEasy has no figures for it. */
export function historyAreaId(catalogData: HistoryCatalog, name: string) {
  const wanted = name.trim().toLowerCase();
  return catalogData.areas.find((area) => area.name.toLowerCase() === wanted)?.id ?? null;
}

export function LongTrend({
  load,
  area,
  bedrooms,
  months,
}: {
  load: LoadHistory;
  /** "NYC", a borough or a neighborhood, by name. */
  area: string;
  bedrooms: number;
  /** How many months back from StreetEasy's latest; 0 is since 2010. */
  months: number;
}) {
  const [state, setState] = useState<{ chart: { months: string[]; values: (number | null)[] } | null; message: string }>({
    chart: null,
    message: 'Loading…',
  });
  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, message: 'Loading…' }));
    catalog(load)
      .then(async (data) => {
        const id = historyAreaId(data, area);
        const series = data.series.find(({ metric, segment }) => metric === 'medianAskingRent' && segment === SEGMENTS[bedrooms]);
        if (id === null || !series)
          return { chart: null, message: `StreetEasy has no history for ${area}; longer ranges cover New York City only.` };
        const from = months ? shiftMonth(data.latestMonth, 1 - months) : '2010-01';
        const values = await load<HistoryValues>(
          `history/values?series=${series.name}&areas=${id}&from=${from}&to=${data.latestMonth}`,
          controller.signal,
        );
        return { chart: { months: values.months, values: values.values[series.name]?.[id] ?? [] }, message: '' };
      })
      .then((next) => !controller.signal.aborted && setState(next))
      .catch(
        () =>
          !controller.signal.aborted && setState({ chart: null, message: 'StreetEasy’s history could not be loaded. Try again shortly.' }),
      );
    return () => controller.abort();
  }, [load, area, bedrooms, months]);
  if (!state.chart) return <Text style={styles.smallMuted}>{state.message}</Text>;
  return (
    <View style={{ gap: 6 }}>
      <LineChart
        months={state.chart.months}
        series={[{ key: area, label: area, color: SERIES_COLORS[0], values: state.chart.values }]}
        format={(value) => formatValue(value, 'USD')}
        formatAxis={(value) => formatValue(value, 'USD', true)}
      />
      <Text style={styles.smallMuted}>Source: StreetEasy Data Dashboard, monthly median asking rent. Blank months are unknown.</Text>
    </View>
  );
}
