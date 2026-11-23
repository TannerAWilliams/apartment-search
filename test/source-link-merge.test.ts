import { expect, test } from 'bun:test';
import { mergeSourceLinks, orderedListingLinks } from '../src/listings.ts';

const url = 'https://streeteasy.com/rental/123';
const fresh = { id: 'streeteasy', name: 'StreetEasy', kind: 'feed', url };

test('fresh source evidence survives same-URL cached or historical duplicates in either order', () => {
  for (const kind of ['cached', 'snapshot', 'saved', 'verified']) {
    const older = { ...fresh, kind };
    expect(mergeSourceLinks([older], [fresh])).toStrictEqual([fresh]);
    expect(mergeSourceLinks([fresh], [older])).toStrictEqual([fresh]);
  }
});

test('promoting one URL never promotes another cached URL or mutates inputs', () => {
  const cached = Object.freeze({ ...fresh, kind: 'cached' });
  const other = Object.freeze({ ...cached, id: 'other', url: 'https://example.test/other' });
  const before = Object.freeze([cached, other]);
  const result = mergeSourceLinks(before, [fresh]);
  expect(result).toStrictEqual([fresh, other]);
  expect(cached.kind).toBe('cached');
  expect(result.filter(({ kind }) => kind === 'feed').length).toBe(1);
  expect(orderedListingLinks(result)[0]).toBe(fresh);
});

test('deduplication remains idempotent and keeps precedence when freshness is equal', () => {
  const second = { ...fresh, name: 'Alternate name' };
  expect(mergeSourceLinks([fresh], [second])).toStrictEqual([fresh]);
  const cached = { ...fresh, kind: 'cached' };
  expect(mergeSourceLinks([cached], [cached])).toStrictEqual([cached]);
  expect(mergeSourceLinks([cached], [])).toStrictEqual([cached]);
});
