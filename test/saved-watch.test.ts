import { expect, test } from 'bun:test';
import { runAlerts } from '../server/alerts.ts';
import { writeSaved } from '../server/saved.ts';
import { MISSING_CHECKS, savedAlerts } from '../server/saved-watch.ts';
import { testListing } from './fixtures/listing.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const home = (id: string, rent: number, more: object = {}) =>
  testListing({ id, address: `${id} Example Street`, unit: '2A', city: 'Brooklyn', rent, ...more });
const now = new Date('2026-11-26T12:00:00Z');

test('a saved apartment that drops its rent is reported once, from the rent it had', async () => {
  const bucket = createMemoryBucket();
  await writeSaved(bucket, 'ana@example.test', [home('10', 3000), home('12', 2500)]);
  // Unchanged: nothing to say. An account with nothing saved is passed over.
  expect(await savedAlerts(bucket, ['Ana@example.test', 'ben@example.test'], [home('10', 3000), home('12', 2500)], now)).toEqual([]);
  const [alert] = await savedAlerts(bucket, ['ana@example.test'], [home('10', 2850), home('12', 2600)], now);
  expect(alert).toMatchObject({
    owner: 'ana@example.test',
    ruleId: 'saved',
    title: 'Your saved apartments: 1 price drop',
    lines: ['10 Example Street, Unit 2A, Brooklyn: $3,000 → $2,850'],
    urls: ['/listing/10'],
    dropCount: 1,
  });
  // The same rent again says nothing; a rise is followed, so a later drop is measured from it.
  expect(await savedAlerts(bucket, ['ana@example.test'], [home('10', 2850), home('12', 2600)], now)).toEqual([]);
  const [later] = await savedAlerts(bucket, ['ana@example.test'], [home('10', 2850), home('12', 2550)], now);
  expect(later!.lines).toEqual(['12 Example Street, Unit 2A, Brooklyn: $2,600 → $2,550']);
});

test('an apartment is called gone only after it has been missing three checks in a row, and once', async () => {
  const bucket = createMemoryBucket();
  await writeSaved(bucket, 'ana@example.test', [home('10', 3000), home('12', 2500)]);
  const others = [home('12', 2500)];
  const check = () => savedAlerts(bucket, ['ana@example.test'], others, now);
  for (let missed = 1; missed < MISSING_CHECKS; missed++) expect(await check(), 'one source failing to answer is not gone').toEqual([]);
  const [alert] = await check();
  expect(alert).toMatchObject({
    title: 'Your saved apartments: 1 no longer listed',
    lines: ['10 Example Street, Unit 2A, Brooklyn: no longer listed'],
    urls: [''],
  });
  expect(await check(), 'said once').toEqual([]);
  // Back on the market at less: a drop, and it can be called gone again later.
  const [back] = await savedAlerts(bucket, ['ana@example.test'], [...others, home('10', 2900)], now);
  expect(back!.title).toBe('Your saved apartments: 1 price drop');
  // The same unit under another listing's name is found by its address and unit.
  await writeSaved(bucket, 'cy@example.test', [home('20', 3000)]);
  const relisted = home('other-id', 2800, { address: '20 Example Street' });
  const [found] = await savedAlerts(bucket, ['cy@example.test'], [relisted], now);
  expect(found).toMatchObject({ dropCount: 1, urls: ['/listing/other-id'] });
  // Both at once, and an empty inventory (nothing could be read) says nothing about anyone's.
  await writeSaved(bucket, 'di@example.test', [home('30', 3000), home('31', 2000)]);
  for (let missed = 1; missed < MISSING_CHECKS; missed++) await savedAlerts(bucket, ['di@example.test'], [home('30', 3000)], now);
  const [both] = await savedAlerts(bucket, ['di@example.test'], [home('30', 2900)], now);
  expect(both!.title).toBe('Your saved apartments: 1 price drop, 1 no longer listed');
  expect(await savedAlerts(bucket, ['di@example.test'], [], now)).toEqual([]);
  // One account's unreadable storage does not stop the others'.
  const broken = { ...bucket, get: async () => Promise.reject(new Error('storage is down')) } as typeof bucket;
  expect(await savedAlerts(broken, ['ana@example.test'], others, now)).toEqual([]);
});

test('the alert run checks saved apartments for every account, and goes on when it cannot', async () => {
  const { fakeD1 } = await import('./fixtures/fake-d1.ts');
  // Without a database of accounts there is nobody to check for; the run still completes.
  expect(await runAlerts({ BUCKET: createMemoryBucket() })).toMatchObject({ alerts: [] });
  // With accounts: each one's saved apartments are looked for in what is listed now.
  const { d1 } = await fakeD1();
  const at = new Date().toISOString();
  await d1.batch([
    d1
      .prepare('INSERT INTO "user" ("id","name","email","emailVerified","createdAt","updatedAt") VALUES (?1,?2,?2,1,?3,?3)')
      .bind('u1', 'ana@example.test', at),
  ]);
  const bucket = Object.assign(createMemoryBucket(), { database: d1 });
  await writeSaved(bucket, 'ana@example.test', [home('10', 3000)]);
  expect(await runAlerts({ BUCKET: bucket, PUBLIC_APP: 'true' })).toMatchObject({ alerts: [] });
  const { watchKey } = await import('../server/saved.ts');
  expect(await bucket.get(await watchKey('ana@example.test')), 'what was seen of the saved apartment is kept').not.toBeNull();
  // Accounts that cannot be read: the watch is skipped and logged, and the alerts still run.
  const failing = { prepare: () => ({ all: async () => Promise.reject(new Error('database is down')) }) };
  const down = Object.assign(createMemoryBucket(), { database: failing as unknown as typeof d1 });
  expect(await runAlerts({ BUCKET: down })).toMatchObject({ alerts: [] });
});
