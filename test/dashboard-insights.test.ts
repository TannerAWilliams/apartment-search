import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { dashboardChange, dashboardInsights, dashboardPlot, shiftDashboardMonth } from '../src/dashboard-insights.ts';
import type { DashboardFile } from '../src/dashboard-data.ts';
const file: DashboardFile = {
  name: 'medianAskingRent_All.csv',
  metric: 'medianAskingRent',
  segment: 'All',
  months: ['2024-01', '2024-12', '2025-01', '2025-02'],
  areas: [
    { name: 'A', borough: 'Queens', type: 'neighborhood', values: [100, 110, 120, null] },
    { name: 'B', borough: 'Queens', type: 'neighborhood', values: [90, 100, 100, 0] },
    { name: 'Queens', borough: 'Queens', type: 'borough', values: [200, 200, 200, 200] },
    { name: 'C', borough: 'Brooklyn', type: 'neighborhood', values: [80, 80, 80, 80] },
    { name: 'D', borough: 'Queens', type: 'neighborhood', values: [null, -5, -5, null] },
  ],
};
test('calendar exact baseline comparisons and comparable peers only', () => {
  const s = dashboardInsights(file, 0, '2025-01');
  expect(required(required(s).monthly).value).toBeCloseTo(9.0909);
  expect(required(required(s).yearly).value).toBe(20);
  expect(required(s).peers).toEqual({ count: 2, below: 1, equal: 1 });
  expect(required(s).latest).toBe('2025-01');
  expect(required(dashboardInsights(file, 0, '2025-02')).monthly).toBeNull();
  expect(required(dashboardInsights(file, 0, '2024-12')).monthly).toBeNull();
  expect(dashboardInsights(file, 0, '2020-01')).toBeNull();
  expect(dashboardInsights(file, 99, '2025-01')).toBeNull();
});
test('percentage points versus relative changes and zero/missing/anomaly baselines', () => {
  expect(required(dashboardChange(0.3, 0.2, 'discountShare')).value).toBeCloseTo(10);
  expect(required(dashboardChange(1.1, 1, 'saleListRatio')).unit).toBe('percentage points');
  expect(required(dashboardChange(0.1, 0, 'discountShare')).value).toBe(10);
  for (const v of [null, -1, NaN, Infinity]) expect(dashboardChange(10, v, 'medianAskingRent')).toBeNull();
  expect(dashboardChange(10, 0, 'rentalInventory')).toBeNull();
  expect(required(dashboardChange(0, 10, 'rentalInventory')).value).toBe(-100);
});
test('range and missing values retain explicit gaps, anomalies excluded only from visual/insights', () => {
  expect(dashboardPlot(file, 0, '2025-01', '2025-02')).toEqual([
    { month: '2025-01', value: 120 },
    { month: '2025-02', value: null },
  ]);
  expect(dashboardPlot(file, 4, '2024-12', '2025-01').every((p) => p.value === null)).toBe(true);
  expect(file.areas[4].values[1]).toBe(-5);
  expect(dashboardPlot(file, 99, '2025-01', '2025-01')[0].value).toBeNull();
  expect(shiftDashboardMonth('2025-01', -1)).toBe('2024-12');
  expect(shiftDashboardMonth('2024-02', -12)).toBe('2023-02');
});
