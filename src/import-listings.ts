import * as v from 'valibot';
import { parse } from 'csv-parse/browser/esm/sync';
import { normalizeListing } from './listings.ts';
import { safeListingUrl } from './marketplaces.ts';
import { isPoint } from './search.ts';

export const MAX_IMPORT_SIZE = 256_000;
export const IMPORT_COLUMNS = 'url,address,unit,city,state,zip,bedrooms,rent';
const required = IMPORT_COLUMNS.split(',').filter((column) => column !== 'unit');

/** Each parsed CSV row, with the line it started on. */
const CsvRowsSchema = v.array(v.object({ record: v.array(v.string()), info: v.object({ lines: v.number() }) }));

export function parseListingImport(csv: string) {
  if (csv.length > MAX_IMPORT_SIZE) throw new Error('Choose a CSV under 256 KB.');
  let rows: v.InferOutput<typeof CsvRowsSchema>;
  try {
    // The parser's output is checked like any other input, so the rest of the import can rely on it.
    rows = v.parse(CsvRowsSchema, parse(csv, { bom: true, skip_empty_lines: true, trim: true, info: true }));
  } catch {
    throw new Error('The CSV has a malformed row. Check the commas and quotation marks.');
  }
  const columns = rows.shift()?.record.map((column) => column.toLowerCase()) ?? [];
  if (new Set(columns).size !== columns.length || !required.every((column) => columns.includes(column))) {
    throw new Error('Use the CSV header shown above, with one column for each field.');
  }
  if (!rows.length || rows.length > 500) throw new Error('Include between 1 and 500 listings per import.');

  const updatedAt = new Date().toISOString();
  return rows.map(({ record, info }) => {
    const row = Object.fromEntries(columns.map((column, index) => [column, record[index]]));
    const state = row.state.toUpperCase();
    if (
      !safeListingUrl(row.url) ||
      !/^\d{5}$/.test(row.zip) ||
      !/^[0-4]$/.test(row.bedrooms) ||
      !/^\d+(\.\d{1,2})?$/.test(row.rent) ||
      !['NY', 'NJ', 'CT', 'PA'].includes(state)
    ) {
      throw new Error(`Check the listing URL, state, ZIP, bedrooms, and rent on line ${info.lines}.`);
    }
    if (
      (row.latitude || row.longitude) &&
      (!row.latitude || !row.longitude || !isPoint({ latitude: Number(row.latitude), longitude: Number(row.longitude) }))
    ) {
      throw new Error(`Enter both valid coordinates on line ${info.lines}, or leave them blank.`);
    }
    const region = state === 'NJ' ? 'nj' : state === 'CT' ? 'ct' : state === 'PA' ? 'pa' : undefined;
    const listing = normalizeListing({ ...row, state, region, updatedAt }, { id: 'saved', name: 'Saved listing', kind: 'saved' });
    if (!listing) throw new Error(`Check the street, city, region, and monthly rent on line ${info.lines}.`);
    return listing;
  });
}
