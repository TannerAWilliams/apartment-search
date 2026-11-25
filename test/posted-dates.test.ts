import { expect, test } from 'bun:test';
import { pathKey, postedDates } from '../server/sources/posted-dates.ts';
import { postedDate } from '../src/listings.ts';

const page = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

test('each listing site’s posting date is read from its page’s listing data, by the link to the listing', () => {
  const html =
    page({
      mainEntity: {
        itemListElement: [
          // Trulia: the link is in the offer.
          {
            item: {
              '@type': 'RealEstateListing',
              datePosted: '2026-11-25T00:46:22+00:00',
              offers: [{ url: 'https://www.trulia.com/home/160-e-broadway-3/' }],
            },
          },
          // Zumper: the link is the listing's own.
          {
            item: {
              '@type': 'RealEstateListing',
              url: 'https://www.zumper.com/apartment-buildings/1818930/blueground',
              datePosted: '2026-11-24',
            },
          },
          { item: { '@type': 'RealEstateListing', '@id': '/a/b', datePosted: '2026-11-20', offers: { url: 'not a link' } } },
          { item: { '@type': 'RealEstateListing', url: '/no-date' } },
        ],
      },
    }) + '<script type="application/ld+json">{ broken</script>';
  const dates = postedDates(html);
  expect(dates.get(pathKey('/home/160-E-Broadway-3'))).toBe('2026-11-25T00:46:22+00:00');
  expect(dates.get(pathKey('https://www.zumper.com/apartment-buildings/1818930/blueground?x=1'))).toBe('2026-11-24');
  expect(dates.get('/a/b')).toBe('2026-11-20');
  expect(dates.has('/no-date')).toBe(false);
  expect(postedDates('<p>no data</p>').size).toBe(0);
  expect(pathKey(undefined)).toBe('');
  expect(pathKey('http://[bad')).toBe('');
});

test('a posting date is kept only when it is a real date, not in the future', () => {
  expect(postedDate('2026-11-24')).toEqual({ listedAt: '2026-11-24T00:00:00.000Z' });
  expect(postedDate(Date.UTC(2026, 10, 20))).toEqual({ listedAt: '2026-11-20T00:00:00.000Z' });
  for (const bad of [undefined, '', 'soon', '1999-01-01', Date.now() + 3 * 86_400_000, null]) expect(postedDate(bad)).toEqual({});
});
