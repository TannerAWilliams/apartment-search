import { palette } from '../src/palette.ts';
import { expect, test } from 'bun:test';
import { divergingColor, textOn } from '../src/chart-colors.ts';
import {
  change,
  changeUnit,
  divergingPosition,
  formatChange,
  formatValue,
  type HistoryArea,
  type HistoryMonth,
  indexed,
  latest,
  monthLabel,
  monthName,
  nearestIndex,
  niceTicks,
  ranking,
  scatterPoints,
  seasonality,
  shiftMonth,
  usable,
  valueScale,
  yearOverYearGrid,
} from '../src/market-history.ts';

const months = (from: string, count: number) => Array.from({ length: count }, (_, index) => shiftMonth(from, index));

test('months shift across years and read as people write them', () => {
  expect([shiftMonth('2026-10', 3), shiftMonth('2026-01', -1), shiftMonth('2026-10', -12)]).toEqual(['2027-01', '2025-12', '2025-10']);
  expect([monthName('2026-10'), monthLabel('2026-10'), monthName('2026-13')]).toEqual(['Oct', 'Oct 2026', '2026-13']);
});

test('values and changes are written as people read them', () => {
  expect([formatValue(4100, 'USD'), formatValue(1_250_000, 'USD', true), formatValue(4100, 'USD', true)]).toEqual([
    '$4,100',
    '$1.3M',
    '$4,100',
  ]);
  expect([
    formatValue(27_100, 'count', true),
    formatValue(356, 'count', true),
    formatValue(0.165, 'share'),
    formatValue(1.012, 'ratio'),
  ]).toEqual(['27.1K', '356', '16.5%', '101.2%']);
  expect([formatValue(61, 'days'), formatValue(null, 'USD'), formatValue(undefined, 'USD'), formatValue(Number.NaN, 'USD')]).toEqual([
    '61 days',
    '—',
    '—',
    '—',
  ]);
  expect([formatChange(3.8, 'USD'), formatChange(-2.4, 'share'), formatChange(0, 'USD'), formatChange(null, 'USD')]).toEqual([
    '+3.8%',
    '−2.4 pts',
    '0.0%',
    '—',
  ]);
  expect([changeUnit('share'), changeUnit('ratio'), changeUnit('USD')]).toEqual(['pts', 'pts', '%']);
});

test('changes are percent, or percentage points for shares, and unknown when either side is', () => {
  expect(change(4100, 3950, 'USD')).toBeCloseTo(3.797, 2);
  expect(change(0.115, 0.139, 'share')).toBeCloseTo(-2.4, 5);
  expect([change(null, 1, 'USD'), change(1, undefined, 'USD'), change(-3, 1, 'days'), change(5, 0, 'count')]).toEqual([
    null,
    null,
    null,
    null,
  ]);
  expect([usable(0), usable(-1), usable(Number.POSITIVE_INFINITY), usable(null)]).toEqual([true, false, false, false]);
});

test('ticks are round numbers covering the range, and scales pad it', () => {
  expect(niceTicks(0, 10, 5)).toEqual([0, 2.5, 5, 7.5, 10]);
  expect(niceTicks(2700, 5100, 5)).toEqual([3000, 4000, 5000]);
  expect(niceTicks(-4.2, 3.9, 5)).toEqual([-2.5, 0, 2.5]);
  expect([niceTicks(5, 5), niceTicks(Number.NaN, 1)]).toEqual([[5], []]);
  expect(niceTicks(0, 1e9, 2)).toEqual([0, 1e9]);
  const rent = valueScale([3000, null, 4100], 'USD')!;
  expect(rent.min).toBeLessThan(3000);
  expect(rent.max).toBeGreaterThan(4100);
  expect(valueScale([10, 20], 'count')!.min).toBe(0);
  expect(valueScale([5, 5], 'USD')!.ticks.length).toBeGreaterThan(0);
  expect(valueScale([0, 0], 'share')!.max).toBeGreaterThan(0);
  expect(valueScale([null, -1], 'days')).toBeNull();
});

test('indexing measures change from the first known value', () => {
  expect(indexed([null, 2000, 2200, null, 1800])).toEqual([null, 0, 10, null, -10]);
  expect(indexed([0, 5])).toEqual([null, null]);
});

test('the latest figure is the last usable month, with its yearly and monthly change', () => {
  const range = months('2025-01', 22);
  const values = range.map((_, index) => (index === 21 ? null : 1000 + index * 10));
  expect(latest(range, values, 'USD')).toEqual({
    month: '2026-09',
    value: 1200,
    yearly: change(1200, 1080, 'USD'),
    monthly: change(1200, 1190, 'USD'),
  });
  expect(
    latest(
      range,
      range.map(() => null),
      'USD',
    ),
  ).toBeNull();
});

test('the year-over-year grid lists years newest first and leaves out what was not reported', () => {
  const range = months('2024-01', 30);
  const values = range.map((month) => (month === '2025-03' ? null : month < '2025-01' ? 1000 : 1100));
  const grid = yearOverYearGrid(range, values, 'USD');
  // 2024 has no earlier year to compare with, so it is left out.
  expect(grid.rows.map(({ year }) => year)).toEqual(['2026', '2025']);
  expect(grid.rows[1]!.cells[0]).toEqual({ month: '2025-01', inRange: true, value: change(1100, 1000, 'USD') });
  expect(grid.rows[1]!.cells[2]!.value).toBeNull();
  expect(grid.rows[0]!.cells[11]).toEqual({ month: '2026-12', inRange: false, value: null });
  expect(grid.extent).toBeCloseTo(10, 5);
  expect(yearOverYearGrid([], [], 'USD')).toEqual({ rows: [], extent: 0 });
});

test('seasonality averages each month against its year, over complete years only', () => {
  const range = months('2024-01', 30);
  // Every complete year runs 10% above its average in September and 10% below in February.
  const values = range.map((month) => (month.endsWith('-09') ? 1100 : month.endsWith('-02') ? 900 : month === '2026-06' ? null : 1000));
  const result = seasonality(range, values);
  expect(result[8]).toEqual({ name: 'Sep', value: 10, years: 2 });
  expect(result[1]!.value).toBeCloseTo(-10, 5);
  expect(seasonality(months('2024-01', 12), Array(12).fill(0)).every(({ value }) => value === null)).toBe(true);
});

const AREAS: HistoryArea[] = [
  { id: 1, name: 'NYC', borough: '', type: 'city' },
  { id: 2, name: 'Brooklyn', borough: 'Brooklyn', type: 'borough' },
  { id: 3, name: 'Park Slope', borough: 'Brooklyn', type: 'neighborhood' },
  { id: 4, name: 'DUMBO', borough: 'Brooklyn', type: 'neighborhood' },
  { id: 5, name: 'Astoria', borough: 'Queens', type: 'neighborhood' },
  { id: 6, name: 'Gowanus', borough: 'Brooklyn', type: 'neighborhood' },
];
const MONTH: HistoryMonth = {
  series: 'medianAskingRent_All.csv',
  month: '2026-10',
  yearAgo: '2025-10',
  rows: [
    { area: 1, value: 4100, yearAgo: 3950 },
    { area: 2, value: 3866, yearAgo: 3750 },
    { area: 3, value: 4900, yearAgo: 4150 },
    { area: 4, value: 5900, yearAgo: 6000 },
    { area: 5, value: 3200, yearAgo: null },
    { area: 6, value: null, yearAgo: 4000 },
    { area: 99, value: 1, yearAgo: 1 },
  ],
};

test('neighborhoods rank by value or by change, within a borough or across the city', () => {
  expect(ranking(MONTH, AREAS, 'USD', '', 'value').map(({ name }) => name)).toEqual(['DUMBO', 'Park Slope', 'Astoria']);
  expect(ranking(MONTH, AREAS, 'USD', 'Brooklyn', 'value').map(({ name }) => name)).toEqual(['DUMBO', 'Park Slope']);
  const byChange = ranking(MONTH, AREAS, 'USD', '', 'change');
  expect(byChange.map(({ name }) => name)).toEqual(['Park Slope', 'DUMBO', 'Astoria']);
  expect(byChange[2]!.change).toBeNull();
  // Ties order by name.
  const tie = {
    ...MONTH,
    rows: [
      { area: 4, value: 10, yearAgo: null },
      { area: 3, value: 10, yearAgo: null },
    ],
  };
  expect(ranking(tie, AREAS, 'USD', '', 'value').map(({ name }) => name)).toEqual(['DUMBO', 'Park Slope']);
});

test('scatter points need both measures for a neighborhood', () => {
  const cuts: HistoryMonth = {
    ...MONTH,
    rows: [
      { area: 3, value: 0.115, yearAgo: 0.139 },
      { area: 4, value: 0.2, yearAgo: null },
      { area: 1, value: 0.16, yearAgo: null },
    ],
  };
  const points = scatterPoints(
    MONTH,
    cuts,
    AREAS,
    (row) => change(row.value, row.yearAgo, 'USD'),
    (row) => row.value,
  );
  expect(points.map(({ name, y }) => [name, y])).toEqual([
    ['Park Slope', 0.115],
    ['DUMBO', 0.2],
  ]);
  expect(
    scatterPoints(
      MONTH,
      cuts,
      AREAS,
      () => Number.NaN,
      () => 1,
    ),
  ).toEqual([]);
});

test('pointer positions snap to the nearest month, and diverging positions stay within −1..1', () => {
  expect([nearestIndex(0.5, 11), nearestIndex(-0.2, 11), nearestIndex(1.4, 11)]).toEqual([5, 0, 10]);
  expect([divergingPosition(5, 10), divergingPosition(-20, 10), divergingPosition(3, 0)]).toEqual([0.5, -1, 0]);
});

test('the diverging scale runs blue through gray to red, with readable text on its ends', () => {
  expect([divergingColor(0), divergingColor(1), divergingColor(-1), divergingColor(2)]).toEqual([
    palette.gray[0],
    palette.red[6],
    palette.blue[6],
    palette.red[6],
  ]);
  expect([textOn(0.9), textOn(-0.2)]).toEqual(['#ffffff', palette.gray[9]]);
});
