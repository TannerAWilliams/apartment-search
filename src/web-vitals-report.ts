import type { Metric } from 'web-vitals';

/**
 * Real-user performance: the Core Web Vitals each visit measures (load, responsiveness, layout shift),
 * sent once when the page is hidden to /api/vitals, which writes them to Workers Logs. No third party is
 * involved, and automated browsers (tests, crawlers) are not measured.
 */
export const VITAL_NAMES = ['CLS', 'FCP', 'INP', 'LCP', 'TTFB'] as const;
export type VitalMetric = { name: (typeof VITAL_NAMES)[number]; value: number; rating: 'good' | 'needs-improvement' | 'poor'; navigationType?: string };
export type VitalReport = { page: string; metrics: VitalMetric[] };

export function vitalReport(metrics: Pick<Metric, 'name' | 'value' | 'rating' | 'navigationType'>[], page: string): VitalReport {
  return { page, metrics: metrics.map(({ name, value, rating, navigationType }) =>
    ({ name: name as VitalMetric['name'], value: Math.round(value * 1000) / 1000, rating, navigationType })) };
}

type Page = { automated: boolean; tab(): string; hidden(): boolean; on(event: 'visibilitychange' | 'pagehide', listener: () => void): void };
type Library = Pick<typeof import('web-vitals'), 'onCLS' | 'onFCP' | 'onINP' | 'onLCP' | 'onTTFB'>;

const browserPage = (): Page | null => typeof window === 'undefined' || typeof document === 'undefined' ? null : {
  automated: navigator.webdriver === true,
  tab: () => location.hash.slice(1) || 'results',
  hidden: () => document.visibilityState === 'hidden',
  on: (event, listener) => (event === 'pagehide' ? window : document).addEventListener(event, listener),
};
const beacon = (body: string) => navigator.sendBeacon('/api/vitals', new Blob([body], { type: 'application/json' }));

/** Starts measuring. Each metric keeps its latest value; the batch is sent when the page is hidden or left. */
export async function startVitals({ page = browserPage(), load = () => import('web-vitals') as Promise<Library>, send = beacon }:
  { page?: Page | null; load?: () => Promise<Library>; send?: (body: string) => unknown } = {}) {
  if (!page || page.automated) return false;
  const library = await load();
  const latest = new Map<string, Metric>();
  const keep = (metric: Metric) => { latest.set(metric.name, metric); };
  for (const measure of [library.onCLS, library.onFCP, library.onINP, library.onLCP, library.onTTFB]) measure(keep);
  const flush = () => {
    if (!latest.size) return;
    send(JSON.stringify(vitalReport([...latest.values()], page.tab())));
    latest.clear();
  };
  page.on('visibilitychange', () => { if (page.hidden()) flush(); });
  page.on('pagehide', flush);
  return true;
}
