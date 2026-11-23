import { test, expect } from 'bun:test';
import { DASHBOARD_FILES, type DashboardFile } from '../src/dashboard-data.ts';
import { dashboardChoices, dashboardMarket, dashboardSegmentLabel, selectDashboardMetric } from '../src/dashboard-selection.ts';
const catalog = DASHBOARD_FILES.map((name) => {
  const [metric, segment] = name.slice(0, -4).split('_');
  return { name, metric: metric as DashboardFile['metric'], segment };
});
test('all 45 stored series remain reachable through market, metric and segment controls', () => {
  expect(catalog).toHaveLength(45);
  for (const file of catalog) {
    const choices = dashboardChoices(catalog, file.name);
    expect(choices.markets).toContain(dashboardMarket(file.metric));
    expect(choices.metrics).toContain(file.metric);
    expect(choices.segments).toContain(file);
    expect(selectDashboardMetric(catalog, file.metric, file.segment)).toEqual(file);
  }
});
test('metric transitions preserve compatible segment and fall back without inventing missing files', () => {
  expect(selectDashboardMetric(catalog, 'rentalInventory', 'TwoBd')?.segment).toBe('TwoBd');
  expect(selectDashboardMetric(catalog, 'rentalIndex', 'TwoBd')?.segment).toBe('All');
  expect(selectDashboardMetric([], 'rentalIndex')).toBeUndefined();
  expect(dashboardChoices([], 'missing').metrics).toEqual([]);
  expect(dashboardChoices(catalog.slice(0, 1), 'missing').current).toEqual(catalog[0]);
  expect(
    dashboardChoices(
      catalog.filter((file) => file.metric === 'medianAskingRent'),
      'missing',
    ).markets,
  ).toEqual(['Rentals']);
  expect(dashboardSegmentLabel('ThreePlusBd')).toBe('3+ bedrooms');
  expect(dashboardSegmentLabel('custom')).toBe('custom');
});
