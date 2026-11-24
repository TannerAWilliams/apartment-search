import { expect, test } from 'bun:test';
import { offline, search } from '../server/search.ts';
import { parseFilters } from '../src/search.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import './fixtures/quiet-logs.ts';

test('one listing is found by its ID for its own page, and a missing one says so', async () => {
  const { matches } = await search(parseFilters({ region: 'all', bedrooms: null, maxRent: null }), {}, offline, true);
  const wanted = matches[3]!;
  const found = await readJson<{ listing: { id: string; insights: object } }>(
    handleApi(new Request('https://app.test/api/listing?id=' + encodeURIComponent(wanted.id)), {}),
  );
  expect(found.listing.id).toBe(wanted.id);
  expect(found.listing.insights).toBeDefined();
  const missing = await handleApi(new Request('https://app.test/api/listing?id=nope'), {});
  expect(missing.status).toBe(404);
  expect((await handleApi(new Request('https://app.test/api/listing'), {})).status).toBe(422);
});
