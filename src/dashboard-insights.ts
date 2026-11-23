import { METRICS, type DashboardFile } from './dashboard-data.ts';
function validDashboardValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
export function shiftDashboardMonth(month: string, offset: number) {
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
export function dashboardChange(current: number | null, previous: number | null, metric: DashboardFile['metric']) {
  if (!validDashboardValue(current) || !validDashboardValue(previous)) return null;
  if (['share', 'ratio'].includes(METRICS[metric][1])) return { value: (current - previous) * 100, unit: 'percentage points' };
  return previous === 0 ? null : { value: ((current - previous) / previous) * 100, unit: '%' };
}
export function dashboardInsights(file: DashboardFile, areaIndex: number, month: string) {
  const area = file.areas[areaIndex],
    index = file.months.indexOf(month);
  if (!area || index < 0) return null;
  const current = area.values[index];
  const previous = (offset: number) => area.values[file.months.indexOf(shiftDashboardMonth(month, offset))] ?? null;
  const peers = file.areas.filter((a) => a.type === area.type && a.borough === area.borough && validDashboardValue(a.values[index]));
  const latest = file.months.filter((_, i) => validDashboardValue(area.values[i])).at(-1) ?? null;
  return {
    current,
    latest,
    monthly: dashboardChange(current, previous(-1), file.metric),
    yearly: dashboardChange(current, previous(-12), file.metric),
    peers: validDashboardValue(current)
      ? {
          count: peers.length,
          below: peers.filter((a) => {
            const value = a.values[index];
            return validDashboardValue(value) && value < current;
          }).length,
          equal: peers.filter((a) => a.values[index] === current).length,
        }
      : null,
  };
}
export function dashboardPlot(file: DashboardFile, areaIndex: number, start: string, end: string) {
  const area = file.areas[areaIndex];
  return file.months
    .map((month, i) => ({ month, value: area?.values[i] ?? null }))
    .filter((p) => p.month >= start && p.month <= end)
    .map((p) => ({ ...p, value: validDashboardValue(p.value) ? p.value : null }));
}
