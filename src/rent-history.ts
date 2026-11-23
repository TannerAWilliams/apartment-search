export type RentArea = { id: string; label: string; detail: string; count: number; sizes: { median: number | null; count: number }[] };
export type PackedRentRow = [string, ...(number | null)[]];
export type RentHistory = [string, PackedRentRow[]][];
export type RentPoint = { month: string; median: number | null; count: number };
export type RentMarket = { month: string; areas: RentArea[]; history: RentHistory };
const MONTH_COUNT = 6;

export function priorRentMonths(latest: string) {
  return Array.from({ length: MONTH_COUNT - 1 }, (_, index) => {
    const date = new Date(latest + '-01T00:00:00Z');
    date.setUTCMonth(date.getUTCMonth() + index - MONTH_COUNT + 1);
    return date.toISOString().slice(0, 7);
  });
}

export function rentSeries(area: RentArea, bedrooms: number, month: string, history: RentHistory): RentPoint[] {
  const points = history.map(([period, areas]) => {
    const row = areas.find(([id]) => id === area.id);
    const offset = 1 + bedrooms * 2;
    const median = row?.[offset],
      count = row?.[offset + 1];
    return { month: period, median: typeof median === 'number' ? median : null, count: typeof count === 'number' ? count : 0 };
  });
  return [...points, { month, ...area.sizes[bedrooms] }];
}
