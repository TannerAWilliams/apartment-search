import { parse } from 'csv-parse/browser/esm/sync';
import { DASHBOARD_FILES, METRICS, type DashboardFile } from '../src/dashboard-data.ts';

/** Parses the StreetEasy dashboard CSVs on the server, so the web app does not bundle a CSV parser for them. */
const month = /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/;
function validateMonths(months: string[]) {
  if (!months.length || months.length > 1200 || months.some((m, i) => !month.test(m) || (i > 0 && m <= months[i - 1])))
    throw new Error('Invalid, duplicated or unordered months.');
}
function value(cell: string, unit: string): number | null {
  if (cell.trim() === '') return null;
  if (!(unit === 'days' ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/).test(cell)) throw new Error('Invalid numeric observation.');
  const n = Number(cell);
  if (!Number.isFinite(n) || n > 1e12 || (unit === 'share' && n > 1) || (unit === 'count' && !Number.isInteger(n)))
    throw new Error('Observation outside its metric domain.');
  return n;
}
export function parseDashboardCsv(name: string, csv: string): DashboardFile {
  if (!DASHBOARD_FILES.includes(name)) throw new Error('Unsupported dashboard filename.');
  if (new TextEncoder().encode(csv).length > 4 * 1024 * 1024) throw new Error('CSV exceeds 4 MB.');
  const [metric, segment] = name.slice(0, -4).split('_') as [keyof typeof METRICS, string];
  const rows: string[][] = parse(csv, { bom: true, skip_empty_lines: true, max_record_size: 100000 });
  const header = rows.shift();
  if (!header || !rows.length || rows.length > 5000 || rows.some((row) => row.length !== header.length))
    throw new Error('Invalid CSV dimensions.');
  let months: string[];
  let areas: DashboardFile['areas'];
  if (metric.endsWith('Index')) {
    if (header.join(',') !== 'month,Brooklyn,Manhattan,NYC,Queens') throw new Error('Unexpected index schema.');
    months = rows.map((row) => row[0]);
    areas = header.slice(1).map((name, i) => ({
      name,
      borough: name === 'NYC' ? '' : name,
      type: name === 'NYC' ? 'city' : 'borough',
      values: rows.map((row) => value(row[i + 1], METRICS[metric][1])),
    }));
  } else {
    if (header.slice(0, 3).join(',') !== 'areaName,Borough,areaType') throw new Error('Unexpected area schema.');
    months = header.slice(3);
    const seen = new Set<string>();
    areas = rows.map((row) => {
      const [name, borough, type] = row;
      const key = JSON.stringify(row.slice(0, 3));
      if (!name || name.length > 200 || borough.length > 100 || !type || type.length > 100 || seen.has(key))
        throw new Error('Invalid or duplicate area.');
      seen.add(key);
      return { name, borough, type, values: row.slice(3).map((v) => value(v, METRICS[metric][1])) };
    });
  }
  validateMonths(months);
  return { name, metric, segment, months, areas };
}
