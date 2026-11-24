import { expect, test } from 'bun:test';
import { changeHousehold, findHousehold, MAX_SHARED_LISTINGS } from '../server/households.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { testListing } from './fixtures/listing.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

type Reply = {
  household: { members: string[]; invited: string[]; listings: { id: string }[]; votes: object; notes: object } | null;
  error?: string;
};
const call = (bucket: ReturnType<typeof createMemoryBucket>, account: string | undefined, body?: unknown) =>
  handleApi(
    new Request(
      'https://app.test/api/household',
      body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    ),
    { BUCKET: bucket },
    { account },
  );

test('two people share one list: invite, accept, add, vote, note, remove and leave', async () => {
  const bucket = createMemoryBucket();
  const env = bucket;
  expect((await readJson<Reply>(call(env, 'Ana@example.test'))).household).toBeNull();
  const invited = await readJson<Reply>(call(env, 'ana@example.test', { action: 'invite', email: 'Ben@example.test' }));
  expect(invited.household).toMatchObject({ members: ['ana@example.test'], invited: ['ben@example.test'] });
  // Ben sees the invitation, cannot change the list until he accepts, then joins.
  expect((await readJson<Reply>(call(env, 'ben@example.test'))).household?.invited).toEqual(['ben@example.test']);
  expect((await call(env, 'ben@example.test', { action: 'add', listing: testListing() })).status).toBe(422);
  expect((await call(env, 'ben@example.test', { action: 'invite', email: 'cy@example.test' })).status).toBe(422);
  expect((await readJson<Reply>(call(env, 'ben@example.test', { action: 'accept' }))).household?.members).toEqual([
    'ana@example.test',
    'ben@example.test',
  ]);
  expect((await readJson<Reply>(call(env, 'ben@example.test', { action: 'accept' }))).household?.members.length).toBe(2);

  await call(env, 'ana@example.test', { action: 'add', listing: testListing({ id: 'a', rent: 1 }) });
  await call(env, 'ben@example.test', { action: 'add', listing: testListing({ id: 'a', rent: 2 }) });
  await call(env, 'ana@example.test', { action: 'vote', id: 'a', vote: 'yes' });
  await call(env, 'ben@example.test', { action: 'vote', id: 'a', vote: 'no' });
  await call(env, 'ben@example.test', { action: 'vote', id: 'a', vote: null });
  const noted = await readJson<Reply>(call(env, 'ben@example.test', { action: 'note', id: 'a', text: ' Great light ' }));
  expect(noted.household?.listings).toEqual([expect.objectContaining({ id: 'a', rent: 2 })]);
  expect(noted.household?.votes).toEqual({ a: { 'ana@example.test': 'yes' } });
  expect(noted.household?.notes).toEqual({ a: [expect.objectContaining({ by: 'ben@example.test', text: 'Great light' })] });
  expect((await call(env, 'ben@example.test', { action: 'vote', id: 'missing', vote: 'yes' })).status).toBe(422);
  expect((await call(env, 'ben@example.test', { action: 'add', listing: { no: 'id' } })).status).toBe(422);
  const removed = await readJson<Reply>(call(env, 'ana@example.test', { action: 'remove', id: 'a' }));
  expect(removed.household).toMatchObject({ listings: [], votes: {}, notes: {} });

  // Ben leaves; Ana keeps the list.
  expect((await readJson<Reply>(call(env, 'ben@example.test', { action: 'leave' }))).household).toBeNull();
  expect(await findHousehold(bucket, 'ben@example.test')).toBeNull();
  expect((await findHousehold(bucket, 'ana@example.test'))?.members).toEqual(['ana@example.test']);
});

test('shared lists are bounded and refuse what makes no sense', async () => {
  const bucket = createMemoryBucket();
  await expect(changeHousehold(bucket, 'a@x.test', { action: 'invite', email: 'A@x.test' })).rejects.toThrow(/other than yourself/);
  await expect(changeHousehold(bucket, 'a@x.test', { action: 'accept' })).rejects.toThrow(/Invite someone first/);
  for (const partner of ['b', 'c', 'd']) await changeHousehold(bucket, 'a@x.test', { action: 'invite', email: partner + '@x.test' });
  await changeHousehold(bucket, 'a@x.test', { action: 'invite', email: 'b@x.test' });
  await expect(changeHousehold(bucket, 'a@x.test', { action: 'invite', email: 'e@x.test' })).rejects.toThrow(/up to 4 people/);
  await changeHousehold(bucket, 'z@x.test', { action: 'invite', email: 'y@x.test' });
  await expect(changeHousehold(bucket, 'a@x.test', { action: 'invite', email: 'y@x.test' })).rejects.toThrow(/another shared list/);
  for (let index = 0; index <= MAX_SHARED_LISTINGS; index++)
    await changeHousehold(bucket, 'a@x.test', { action: 'add', listing: testListing({ id: String(index) }) });
  expect((await findHousehold(bucket, 'a@x.test'))?.listings.length).toBe(MAX_SHARED_LISTINGS);
  for (let index = 0; index < 25; index++) await changeHousehold(bucket, 'a@x.test', { action: 'note', id: '5', text: 'n' + index });
  expect((await findHousehold(bucket, 'a@x.test'))?.notes['5']?.length).toBe(20);
  expect((await call(bucket, undefined)).status).toBe(404);
  expect((await call(bucket, undefined, { action: 'accept' })).status).toBe(404);
  expect((await call(bucket, 'a@x.test', { action: 'nope' })).status).toBe(422);
  // A pointer to a list that no longer includes the account reads as none.
  await changeHousehold(bucket, 'b@x.test', { action: 'leave' });
  expect(await findHousehold(bucket, 'b@x.test')).toBeNull();
});
