import { expect, test } from 'bun:test';
import { refreshSources } from '../server/refresh.ts';
import {
  WESTCHESTER_HOMESEEKER,
  homeSeekerTime,
  loadHomeSeeker,
  parseHomeSeeker,
  storedHomeSeeker,
} from '../server/westchester-homeseeker.ts';
import type { HousingResponse } from '../server/contracts.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { required } from './test-values.ts';

const now = new Date('2026-11-23T12:00:00Z');
const card = (id: string, name: string, location: string, dates: [string, string, string]) => `<div class="card mt-8 h-100">
  <a class="whl-listing-link" href="/Listings/Details?listingId=${id}"><img class="w-100" src="data:image/jpeg;base64,AAAA&#x2B;BBBB" alt="${name}" /></a>
  <div class="card-body"><h5 class="card-title text-uppercase">${name}</h5>
  <p><i class="fa-solid fa-location-dot"></i>&nbsp;${location}</p>
  <p><small>Application Start Date: ${dates[0]}</small><br /><small>Application End Date: ${dates[1]}</small><br /><small>Lottery Date/Time: ${dates[2]}</small></p></div></div>`;
const page = (rentals: string[], sales: string[] = []) =>
  `<html><div id="listings-rentals-tab-pane">${rentals.join('')}</div><div id="listings-sales-tab-pane">${sales.join('')}</div></html>`;
const willett = card('202606002', '229 Willett Avenue, Port Chester, NY 10573', '229 Willett Ave Port Chester NY\n 10573', [
  '07/30/2026 9:00 AM',
  '09/23/2026 4:00 PM',
  '10/07/2026 11:00 AM',
]);
const ravine = card('202506026', 'Point &amp; Ravine Apartments', '76 Point St Yonkers NY 10701', ['N/A', 'N/A', 'N/A']);
const html = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/html' } });

test('rental opportunities with their dates in New York time; sales and embedded photos are left out', () => {
  const data = parseHomeSeeker(page([willett, ravine], [card('9', 'A house', '1 Elm St Rye NY 10580', ['N/A', 'N/A', 'N/A'])]), now);
  expect(data.opportunities.map(({ id }) => id)).toEqual(['202606002', '202506026']);
  expect(data.opportunities[0]).toEqual({
    id: '202606002',
    name: '229 Willett Avenue, Port Chester, NY 10573',
    location: '229 Willett Ave Port Chester NY 10573',
    zip: '10573',
    applicationStart: '2026-07-30T13:00:00.000Z',
    applicationEnd: '2026-09-23T20:00:00.000Z',
    lottery: '2026-10-07T15:00:00.000Z',
    url: 'https://homeseeker.westchestergov.com/Listings/Details?listingId=202606002',
  });
  expect(required(data.opportunities[1])).toMatchObject({ name: 'Point & Ravine Apartments', applicationEnd: null, lottery: null });
  // Winter dates are five hours behind UTC, summer ones four.
  expect(homeSeekerTime('01/05/2027 4:00 PM')).toBe('2027-01-05T21:00:00.000Z');
  expect(homeSeekerTime('12/31/2026 12:00 AM')).toBe('2026-12-31T05:00:00.000Z');
});

test('a changed page, a card without its details or an odd date fails rather than reporting zero', () => {
  expect(() => parseHomeSeeker('<html>Maintenance</html>', now)).toThrow('recognized listings page');
  expect(() => parseHomeSeeker(page([]), now)).toThrow('empty coverage is unconfirmed');
  expect(() => parseHomeSeeker(page(['<div class="card mt-8 h-100"><h5 class="card-title">X</h5></div>']), now)).toThrow('fully describe');
  expect(() => parseHomeSeeker(page([willett, willett]), now)).toThrow('Duplicate');
  expect(() => homeSeekerTime('September 23')).toThrow('did not recognize');
  expect(() => homeSeekerTime('02/30/2026 9:00 AM')).toThrow('did not recognize');
});

test('the loader refuses errors, other content and oversized pages', async () => {
  await expect(loadHomeSeeker(() => new Response('down', { status: 503 }), now)).rejects.toThrow('HTTP 503');
  await expect(loadHomeSeeker(() => Response.json({}), now)).rejects.toThrow('did not return a listings page');
  const huge = new ReadableStream({
    start(controller) {
      for (let index = 0; index < 25; index++) controller.enqueue(new Uint8Array(1024 * 1024));
      controller.close();
    },
  });
  await expect(loadHomeSeeker(() => new Response(huge, { headers: { 'Content-Type': 'text/html' } }), now)).rejects.toThrow('too large');
});

test('a refresh saves the opportunities, the housing API returns them, and a failed check keeps them', async () => {
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket };
  const check = await refreshSources(env, {
    onDemand: true,
    sourceId: WESTCHESTER_HOMESEEKER.id,
    now,
    fetcher: () => html(page([willett, ravine])),
  });
  expect(check.sources.find(({ id }) => id === WESTCHESTER_HOMESEEKER.id)).toMatchObject({ status: 'updated', listingCount: 2 });
  const saved = required(await storedHomeSeeker(bucket));
  const housing = await readJson<HousingResponse>(handleApi(new Request('https://app.test/api/housing'), env));
  expect(housing.westchester).toEqual(saved);
  const later = new Date(now.getTime() + 60_000);
  const failed = await refreshSources(env, {
    onDemand: true,
    sourceId: WESTCHESTER_HOMESEEKER.id,
    now: later,
    fetcher: () => html('<html>Down</html>'),
  });
  expect(failed.sources.find(({ id }) => id === WESTCHESTER_HOMESEEKER.id)?.status).toBe('failed');
  expect(await storedHomeSeeker(bucket)).toEqual(saved);
});
