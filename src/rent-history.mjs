import base64 from 'base64-js';
import { gunzipSync, strFromU8 } from 'fflate';
import { RENT_HISTORY_GZIP } from './data/rent-history.mjs';

const MONTH_COUNT = 6;
let bundledHistory;

export function priorRentMonths(latest) {
  return Array.from({ length: MONTH_COUNT - 1 }, (_, index) => {
    const date = new Date(latest + '-01T00:00:00Z');
    date.setUTCMonth(date.getUTCMonth() + index - MONTH_COUNT + 1);
    return date.toISOString().slice(0, 7);
  });
}

export function bundledRentAreas(month, region, grouping) {
  bundledHistory ??= JSON.parse(strFromU8(gunzipSync(base64.toByteArray(RENT_HISTORY_GZIP))));
  return bundledHistory[month]?.[region]?.[grouping] ?? [];
}

export function bundledRentHistory(latest, region, grouping) {
  return priorRentMonths(latest).map((month) => [month, bundledRentAreas(month, region, grouping)]);
}

export function rentSeries(area, bedrooms, month, history) {
  const points = history.map(([period, areas]) => {
    const row = areas.find(([id]) => id === area.id);
    const offset = 1 + bedrooms * 2;
    return { month: period, median: row?.[offset] ?? null, count: row?.[offset + 1] ?? 0 };
  });
  return [...points, { month, ...area.sizes[bedrooms] }];
}
