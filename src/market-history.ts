/**
 * The market history page's data and arithmetic: what the API returns, and the year-over-year changes,
 * rankings, seasonality grid, scales and ticks the charts draw. No React, so it is unit-tested.
 * Values are StreetEasy's: a blank month is unknown (null), never zero, and negative days on market are
 * source anomalies that are not plotted.
 */
import type { METRICS } from './dashboard-data.ts';

export type Unit = (typeof METRICS)[keyof typeof METRICS][1];
export type HistorySeries = {
  name: string;
  metric: keyof typeof METRICS;
  segment: string;
  label: string;
  unit: Unit;
  market: 'Rentals' | 'Sales';
  firstMonth: string;
  lastMonth: string;
};
export type HistoryArea = { id: number; name: string; borough: string; type: 'city' | 'borough' | 'neighborhood' };
export type HistoryCatalog = {
  provenance: { source: string; url: string; downloadedAt: string; note: string };
  latestMonth: string;
  series: HistorySeries[];
  areas: HistoryArea[];
};
export type HistoryValues = { months: string[]; values: Record<string, Record<string, (number | null)[]>> };
export type HistoryMonth = {
  series: string;
  month: string;
  yearAgo: string;
  rows: { area: number; value: number | null; yearAgo: number | null }[];
};

/** A value that can be charted: a finite, non-negative number. */
export const usable = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The month `count` months after (or before, when negative) `month`. */
export function shiftMonth(month: string, count: number) {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
/** "Oct 2026". */
export const monthLabel = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;

/** Shares and ratios change in percentage points; everything else in percent. */
export const changeUnit = (unit: Unit) => (unit === 'share' || unit === 'ratio' ? 'pts' : '%');

/** The change from `before` to `after`: percent, or percentage points for shares; null when either is unknown. */
export function change(after: number | null | undefined, before: number | null | undefined, unit: Unit) {
  if (!usable(after) || !usable(before)) return null;
  if (changeUnit(unit) === 'pts') return (after - before) * 100;
  return before === 0 ? null : ((after - before) / before) * 100;
}

/** A value as people read it: $4,100, 38.2%, 61 days, 12,400; `compact` shortens large figures (4.1K, $1.2M). */
export function formatValue(value: number | null | undefined, unit: Unit, compact = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (unit === 'share' || unit === 'ratio') return `${(value * 100).toFixed(1)}%`;
  const number =
    compact && Math.abs(value) >= (unit === 'USD' ? 100_000 : 10_000)
      ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      : Math.round(value).toLocaleString('en-US');
  return unit === 'USD' ? `$${number}` : unit === 'days' ? `${number} days` : number;
}

/** A change as people read it: +3.8%, −1.2 pts. */
export function formatChange(value: number | null, unit: Unit) {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1)}${changeUnit(unit) === 'pts' ? ' pts' : '%'}`;
}

/** Up to `count` round tick values covering min..max (1, 2, 2.5 or 5 times a power of ten apart). */
export function niceTicks(min: number, max: number, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, count - 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
}

/** A y-scale for the values: padded, rounded to ticks, and starting at zero for counts and shares. */
export function valueScale(values: readonly (number | null)[], unit: Unit) {
  const known = values.filter(usable);
  if (!known.length) return null;
  let low = Math.min(...known);
  let high = Math.max(...known);
  if (unit === 'count' || unit === 'share') low = 0;
  const pad = (high - low || Math.abs(high) || 1) * 0.08;
  if (low !== 0) low -= pad;
  high += pad;
  const ticks = niceTicks(low, high);
  return { min: Math.min(low, ticks[0] ?? low), max: Math.max(high, ticks.at(-1) ?? high), ticks };
}

/** Each value as a percent change from the first known value in the range, so areas of any size compare. */
export function indexed(values: readonly (number | null)[]) {
  const base = values.find(usable);
  return values.map((value) => (usable(value) && base ? ((value - base) / base) * 100 : null));
}

/** The latest month with a usable value, its value, and the change from a year and a month earlier. */
export function latest(months: readonly string[], values: readonly (number | null)[], unit: Unit) {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = values[index];
    if (!usable(value)) continue;
    const at = (offset: number) => values[months.indexOf(shiftMonth(months[index]!, offset))];
    return { month: months[index]!, value, yearly: change(value, at(-12), unit), monthly: change(value, at(-1), unit) };
  }
  return null;
}

/** The year-over-year change for each month, laid out as years (rows, newest first) by calendar months. */
export function yearOverYearGrid(months: readonly string[], values: readonly (number | null)[], unit: Unit) {
  const byMonth = new Map(months.map((month, index) => [month, values[index]]));
  const years = [...new Set(months.map((month) => month.slice(0, 4)))].sort().reverse();
  const rows = years.map((year) => ({
    year,
    cells: MONTH_NAMES.map((_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, '0')}`;
      const inRange = byMonth.has(month);
      return { month, inRange, value: inRange ? change(byMonth.get(month), byMonth.get(shiftMonth(month, -12)), unit) : null };
    }),
  }));
  // A year with no comparable month at all (the first year of data) is left out rather than drawn empty.
  const kept = rows.filter((row) => row.cells.some((cell) => cell.value !== null));
  const extent = Math.max(0, ...kept.flatMap((row) => row.cells.map((cell) => Math.abs(cell.value ?? 0))));
  return { rows: kept, extent };
}

/** How each calendar month compares with its year's average, averaged over every complete year: seasonality. */
export function seasonality(months: readonly string[], values: readonly (number | null)[]) {
  const sums = MONTH_NAMES.map(() => ({ total: 0, count: 0 }));
  const byYear = new Map<string, { month: number; value: number }[]>();
  months.forEach((month, index) => {
    const value = values[index];
    if (!usable(value)) return;
    const year = month.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), { month: Number(month.slice(5, 7)) - 1, value }]);
  });
  for (const entries of byYear.values()) {
    if (entries.length !== 12) continue;
    const mean = entries.reduce((total, entry) => total + entry.value, 0) / 12;
    if (mean <= 0) continue;
    for (const entry of entries) {
      sums[entry.month]!.total += ((entry.value - mean) / mean) * 100;
      sums[entry.month]!.count++;
    }
  }
  return MONTH_NAMES.map((name, index) => {
    const { total, count } = sums[index]!;
    return { name, value: count ? total / count : null, years: count };
  });
}

export type Ranked = HistoryArea & { value: number; yearAgo: number | null; change: number | null };
/**
 * The neighborhoods with a value this month, in one borough or all, ordered by value (or by change from a
 * year earlier), highest first.
 */
export function ranking(month: HistoryMonth, areas: readonly HistoryArea[], unit: Unit, borough: string, by: 'value' | 'change') {
  const byId = new Map(areas.map((area) => [area.id, area]));
  const rows: Ranked[] = [];
  for (const row of month.rows) {
    const area = byId.get(row.area);
    if (!area || area.type !== 'neighborhood' || !usable(row.value) || (borough && area.borough !== borough)) continue;
    rows.push({ ...area, value: row.value, yearAgo: row.yearAgo, change: change(row.value, row.yearAgo, unit) });
  }
  const key = (row: Ranked) => (by === 'value' ? row.value : (row.change ?? -Infinity));
  return rows.sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
}

export type ScatterPoint = HistoryArea & { x: number; y: number };
/** One point per neighborhood with both measures this month: x and y as the two months' rows give them. */
export function scatterPoints(
  xs: HistoryMonth,
  ys: HistoryMonth,
  areas: readonly HistoryArea[],
  x: (row: HistoryMonth['rows'][number]) => number | null,
  y: (row: HistoryMonth['rows'][number]) => number | null,
) {
  const ysByArea = new Map(ys.rows.map((row) => [row.area, row]));
  const byId = new Map(areas.map((area) => [area.id, area]));
  const points: ScatterPoint[] = [];
  for (const row of xs.rows) {
    const area = byId.get(row.area);
    const other = ysByArea.get(row.area);
    if (!area || area.type !== 'neighborhood' || !other) continue;
    const [px, py] = [x(row), y(other)];
    if (px !== null && py !== null && Number.isFinite(px) && Number.isFinite(py)) points.push({ ...area, x: px, y: py });
  }
  return points;
}

/** The index of the month nearest `position` (0..1 across the chart), for the crosshair. */
export const nearestIndex = (position: number, count: number) => Math.min(count - 1, Math.max(0, Math.round(position * (count - 1))));

/** Where a value sits on a diverging scale: −1 (most negative) to 1 (most positive), 0 at no change. */
export const divergingPosition = (value: number, extent: number) => (extent > 0 ? Math.max(-1, Math.min(1, value / extent)) : 0);
