/**
 * The inventory file: every listing, ready to search, in a form small enough to send to a browser
 * (docs/architecture/search.md). Text, one JSON value per line:
 *
 *   line 1      the header: what the listings came from, and what searching them needs besides the listings
 *   lines 2..n  row groups of about two thousand listings each
 *
 * A row group stores its listings by column, as columnar files do: each field's name once, its values in an
 * array, and a dictionary for text that repeats (a city, a neighborhood, a company). That is under half the size
 * of the listings as JSON objects, and compresses better. Groups let a phone decode the file a piece at a time
 * without freezing the page. Encoding is generic: any JSON-safe field round-trips exactly, so a new listing field
 * needs no change here.
 */
export const INVENTORY_FORMAT = 1;
const GROUP_ROWS = 2000;

type Row = Record<string, unknown>;
type Column =
  | { name: string; values: unknown[]; absent?: number[] }
  | { name: string; dictionary: (string | null)[]; indexes: number[]; absent?: number[] };

/** One row group's JSON for these rows. */
function encodeGroup(rows: Row[]) {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const columns = names.map((name): Column => {
    // A row without the field is noted apart from a row whose field is null: the two are different listings.
    const absent = rows.flatMap((row, index) => (row[name] === undefined ? [index] : []));
    const values = rows.map((row) => row[name] ?? null);
    const extra = absent.length ? { absent } : {};
    const distinct = new Set(values);
    const textual = values.every((value) => value === null || typeof value === 'string');
    // A dictionary pays once the text repeats: each value becomes a small number.
    if (textual && distinct.size * 3 < values.length) {
      const dictionary = [...distinct] as (string | null)[];
      const at = new Map(dictionary.map((value, index) => [value, index]));
      return { name, dictionary, indexes: values.map((value) => at.get(value as string | null)!), ...extra };
    }
    return { name, values, ...extra };
  });
  return JSON.stringify({ rows: rows.length, columns });
}

/** The rows of one row group. */
export function decodeGroup<T extends Row>(text: string): T[] {
  const { rows: count, columns } = JSON.parse(text) as { rows: number; columns: Column[] };
  const rows: Row[] = Array.from({ length: count }, () => ({}));
  for (const column of columns) {
    const absent = new Set(column.absent);
    for (let index = 0; index < count; index++) {
      if (absent.has(index)) continue;
      rows[index]![column.name] = 'dictionary' in column ? column.dictionary[column.indexes[index]!] : column.values[index];
    }
  }
  return rows as T[];
}

/** The file's text for a header and its rows. */
export function encodeInventory(header: Row, rows: Row[]) {
  const groups: string[] = [];
  for (let start = 0; start < rows.length; start += GROUP_ROWS) groups.push(encodeGroup(rows.slice(start, start + GROUP_ROWS)));
  return [JSON.stringify({ ...header, format: INVENTORY_FORMAT, rows: rows.length, groups: groups.length }), ...groups].join('\n');
}

/**
 * The header and rows of a file's text. Between row groups it waits for `pause`, where the caller lets the page
 * respond (the browser passes one; the server and tests need none).
 */
export async function decodeInventory<H extends Row, T extends Row>(text: string, pause?: () => Promise<void>) {
  const [first = '', ...groups] = text.split('\n');
  const header = JSON.parse(first) as H & { format: number; rows: number; groups: number };
  if (header.format !== INVENTORY_FORMAT || header.groups !== groups.length)
    throw new Error('The inventory file is not one this app reads.');
  const rows: T[] = [];
  for (const group of groups) {
    // Appended in place: a spread of two thousand arguments per group is fine, but one array grown is simpler.
    for (const row of decodeGroup<T>(group)) rows.push(row);
    // biome-ignore lint/performance/noAwaitInLoops: the pause between groups is the point: the page stays responsive
    await pause?.();
  }
  if (rows.length !== header.rows) throw new Error('The inventory file is incomplete.');
  return { header, rows };
}
