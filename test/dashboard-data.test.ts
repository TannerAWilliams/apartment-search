import { test, expect } from 'bun:test';
import { DASHBOARD_FILES, dashboardMarket, dashboardSegmentLabel } from '../src/dashboard-data.ts';
import { parseDashboardCsv } from '../server/dashboard-csv.ts';
const csv = 'areaName,Borough,areaType,2025-01,2025-02\nExample,Queens,neighborhood,,0\n';
test('catalog covers all45 families, full history and blanks preserve zero distinction', () => {
  expect(new Set(DASHBOARD_FILES).size).toBe(45);
  const f = parseDashboardCsv('rentalInventory_All.csv', csv);
  expect(f.areas[0].values).toEqual([null, 0]);
  expect(f.months).toEqual(['2025-01', '2025-02']);
  expect([dashboardMarket('discountShare'), dashboardMarket('daysOnMarket')]).toEqual(['Rentals', 'Sales']);
  expect([dashboardSegmentLabel('ThreePlusBd'), dashboardSegmentLabel('custom')]).toEqual(['3+ bedrooms', 'custom']);
});
test('fractions rendered correctly and sale-to-list ratios may exceed1', () => {
  expect(parseDashboardCsv('saleListRatio_All.csv', csv.replace(',0\n', ',1.2\n')).areas[0].values[1]).toBe(1.2);
  expect(() => parseDashboardCsv('discountShare_All.csv', csv.replace(',0\n', ',1.2\n'))).toThrow();
  expect(() => parseDashboardCsv('rentalInventory_All.csv', csv.replace(',0\n', ',1.2\n'))).toThrow();
});
test('index schema transposed without inventing missing periods/values', () => {
  const f = parseDashboardCsv(
    'rentalIndex_All.csv',
    'month,Brooklyn,Manhattan,NYC,Queens\n2007-01,,2500,2200,\n2007-03,2000,2600,2300,2100\n',
  );
  expect(f.areas[0].values).toEqual([null, 2000]);
  expect(f.months).toEqual(['2007-01', '2007-03']);
  expect(() => parseDashboardCsv('rentalIndex_All.csv', csv)).toThrow();
});
test('reject malformed values,duplicate areas/months,schema,dates and unsupported filenames', () => {
  for (const bad of ['NaN', 'Infinity', '-1', '1e2', '1,000', 'x', '1000000000001'])
    expect(() => parseDashboardCsv('medianAskingRent_All.csv', csv.replace(',0\n', `,${bad}\n`))).toThrow();
  for (const bad of [
    csv.replace('2025-02', '2025-01'),
    csv.replace('2025-02', '2024-01'),
    csv.replace('2025-02', '2025-13'),
    csv.replace('areaName', 'name'),
    csv + 'Example,Queens,neighborhood,1,2\n',
    csv.split('\n')[0],
    csv.replace('Example', ''),
  ])
    expect(() => parseDashboardCsv('medianAskingRent_All.csv', bad)).toThrow();
  expect(() => parseDashboardCsv('unknown.csv', csv)).toThrow();
  expect(() => parseDashboardCsv('medianAskingRent_All.csv', ' '.repeat(4 * 1024 * 1024 + 1))).toThrow();
});
