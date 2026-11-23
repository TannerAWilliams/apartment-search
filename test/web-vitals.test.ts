import { afterEach, expect, test } from 'bun:test';
import { startVitals, vitalReport } from '../src/web-vitals-report.ts';
import { handleApi } from './fixtures/api.ts';
import { log } from '../server/log.ts';
import { logRecord } from './fixtures/json.ts';

const quiet = log.sink;
afterEach(() => { log.sink = quiet; });

function fakePage({ automated = false } = {}) {
  const listeners: Record<string, (() => void)[]> = {};
  let hidden = false;
  return {
    page: { automated, tab: () => 'results', hidden: () => hidden, on: (event: string, listener: () => void) => { (listeners[event] ??= []).push(listener); } },
    hide() { hidden = true; for (const listener of listeners.visibilitychange ?? []) listener(); },
    leave() { for (const listener of listeners.pagehide ?? []) listener(); },
  };
}
/** web-vitals stand-in: each metric reports the values queued for it. */
function fakeLibrary(values: Record<string, number[]>) {
  const measure = (name: string) => (report: (metric: { name: string; value: number; rating: string; navigationType: string }) => void) => {
    for (const value of values[name] ?? []) report({ name, value, rating: value > 1000 ? 'poor' : 'good', navigationType: 'navigate' });
  };
  return { onCLS: measure('CLS'), onFCP: measure('FCP'), onINP: measure('INP'), onLCP: measure('LCP'), onTTFB: measure('TTFB') } as never;
}

test('a report rounds values and keeps the rating and navigation type', () => {
  expect(vitalReport([{ name: 'CLS', value: 0.123456, rating: 'needs-improvement', navigationType: 'reload' }], 'saved')).toStrictEqual({ page: 'saved', metrics: [{ name: 'CLS', value: 0.123, rating: 'needs-improvement', navigationType: 'reload' }] });
});

test('measurements are sent once, with each metric\'s latest value, when the page is hidden', async () => {
  const { page, hide, leave } = fakePage();
  const sent: string[] = [];
  expect(await startVitals({ page, load: async () => fakeLibrary({ LCP: [900, 2400], CLS: [0.02] }), send: (body) => sent.push(body) })).toBe(true);
  hide();
  leave();
  expect(sent.length, 'nothing new to send when leaving').toBe(1);
  expect((JSON.parse(sent[0]) as { metrics: { name: string; value: number }[] }).metrics.map(({ name, value }) => [name, value])).toStrictEqual([['CLS', 0.02], ['LCP', 2400]]);
});

test('automated browsers and non-browser runtimes are not measured', async () => {
  let loaded = false;
  const load = async () => { loaded = true; return fakeLibrary({}); };
  expect(await startVitals({ page: fakePage({ automated: true }).page, load })).toBe(false);
  expect(await startVitals({ load }), 'no window under Bun').toBe(false);
  expect(await startVitals(), 'with every default, still no window under Bun').toBe(false);
  expect(loaded).toBe(false);
});

test('the Worker logs valid measurements and refuses anything else', async () => {
  const lines: Record<string, unknown>[] = [];
  log.sink = (_level, line) => { lines.push(logRecord(line)); };
  const post = (body: unknown, type = 'application/json;charset=utf-8') =>
    handleApi(new Request('https://app.test/api/vitals', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': type } }), {});
  const ok = await post({ page: 'results', metrics: [{ name: 'LCP', value: 2400, rating: 'good', navigationType: 'navigate' }, { name: 'FID', value: 1, rating: 'good' }, { name: 'CLS', value: -1, rating: 'good' }] });
  expect(ok.status).toBe(204);
  expect(lines).toStrictEqual([{ level: 'info', event: 'web_vital', name: 'LCP', value: 2400, rating: 'good', page: 'results', navigationType: 'navigate' }]);
  expect((await post({ page: '../../etc', metrics: [{ name: 'TTFB', value: 80, rating: 'good' }] })).status).toBe(204);
  expect(lines.at(-1)?.page, 'an unexpected page name is not logged as given').toBe('other');
  expect((await post({ metrics: [] })).status).toBe(400);
  expect((await post('not json')).status).toBe(400);
  expect((await post({ metrics: [{ name: 'LCP', value: 1, rating: 'good' }] }, 'text/plain')).status, 'only JSON is read').toBe(400);
  expect((await handleApi(new Request('https://app.test/api/vitals'), {})).status).toBe(405);
});

test('in a browser, the batch goes to /api/vitals as a beacon tagged with the open tab', async () => {
  const globals = globalThis as Record<string, unknown>;
  const listeners: Record<string, () => void> = {};
  const beacons: [string, Blob][] = [];
  const saved = { window: globals.window, document: globals.document, location: globals.location, sendBeacon: navigator.sendBeacon };
  try {
    globals.window = { addEventListener: (event: string, listener: () => void) => { listeners[event] = listener; } };
    globals.document = { visibilityState: 'visible', addEventListener: (event: string, listener: () => void) => { listeners[event] = listener; } };
    globals.location = { hash: '#saved' };
    navigator.sendBeacon = (url, body) => { beacons.push([String(url), body as Blob]); return true; };
    expect(await startVitals({ load: async () => fakeLibrary({ INP: [120] }) })).toBe(true);
    listeners.pagehide();
    expect(beacons[0][0]).toBe('/api/vitals');
    expect(beacons[0][1].type).toMatch(/^application\/json/);
    expect(JSON.parse(await beacons[0][1].text())).toStrictEqual({ page: 'saved', metrics: [{ name: 'INP', value: 120, rating: 'good', navigationType: 'navigate' }] });
  } finally {
    globals.window = saved.window; globals.document = saved.document; globals.location = saved.location;
    navigator.sendBeacon = saved.sendBeacon;
  }
});
