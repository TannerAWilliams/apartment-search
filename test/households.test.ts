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

  // Each sets where they commute; removing it leaves the other's.
  const place = { label: 'Rockefeller Center', latitude: 40.7587, longitude: -73.9787 };
  await call(env, 'ana@example.test', { action: 'workplace', workplace: place });
  await call(env, 'ben@example.test', { action: 'workplace', workplace: { ...place, label: 'Penn Station' } });
  const commutes = await readJson<Reply & { household: { workplaces: object } }>(
    call(env, 'ana@example.test', { action: 'workplace', workplace: null }),
  );
  expect(commutes.household?.workplaces).toEqual({ 'ben@example.test': { ...place, label: 'Penn Station' } });
  expect((await call(env, 'ana@example.test', { action: 'workplace', workplace: { label: 'x', latitude: 99, longitude: 0 } })).status).toBe(
    422,
  );

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

test('a link opens the list to anyone who has it: they read it and leave notes, without an account', async () => {
  const bucket = createMemoryBucket();
  const guest = (token: string, body?: unknown) =>
    handleApi(
      new Request(
        'https://app.test/api/shared-list/' + token,
        body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      ),
      { BUCKET: bucket },
      {},
    );
  type Shared = {
    list: { members: string[]; listings: { id: string }[]; votes: object; notes: Record<string, { by: string; text: string }[]> };
  };
  type Linked = { household: { link?: string; members: string[] } | null };
  // One person is enough: the link makes their list.
  const made = await readJson<Linked>(call(bucket, 'ana@example.test', { action: 'link' }));
  const token = made.household!.link!;
  expect(token).toMatch(/^[0-9a-f]{32}$/);
  expect(made.household!.members).toEqual(['ana@example.test']);
  expect(
    (await readJson<Linked>(call(bucket, 'ana@example.test', { action: 'link' }))).household!.link,
    'asking again keeps the link',
  ).toBe(token);
  await call(bucket, 'ana@example.test', { action: 'add', listing: testListing({ id: 'a' }) });
  await call(bucket, 'ana@example.test', { action: 'vote', id: 'a', vote: 'yes' });
  await call(bucket, 'ana@example.test', { action: 'note', id: 'a', text: 'Bright' });

  // The guest sees names, never addresses.
  const opened = await guest(token);
  expect(opened.status).toBe(200);
  expect(opened.headers.get('Cache-Control')).toBe('no-store');
  const { list } = await readJson<Shared>(opened);
  expect(list).toMatchObject({
    members: ['ana'],
    listings: [{ id: 'a' }],
    votes: { a: { ana: 'yes' } },
    notes: { a: [{ by: 'ana', text: 'Bright' }] },
  });
  expect(JSON.stringify(list)).not.toContain('example.test');
  // Their note is kept under the name they give, and members see it marked as a guest's.
  const noted = await readJson<Shared>(guest(token, { id: 'a', name: ' Mom ', text: ' Is there an elevator? ' }));
  expect(noted.list.notes.a!.at(-1)).toMatchObject({ by: 'Mom (guest)', text: 'Is there an elevator?' });
  const seen = await readJson<{ household: { notes: Record<string, { by: string }[]> } }>(call(bucket, 'ana@example.test'));
  expect(seen.household.notes.a!.at(-1)!.by).toBe('guest:Mom');
  // What a guest sends is checked like anything else.
  expect((await guest(token, { id: 'zzz', name: 'Mom', text: 'Hello' })).status).toBe(422);
  expect((await guest(token, { id: 'a', name: '', text: 'Hello' })).status).toBe(422);
  expect((await guest(token, { id: 'a', name: 'Mom', text: 'x'.repeat(501) })).status).toBe(422);
  // A token that is not one, or opens nothing, is not found, to read or to write.
  expect((await guest('not-a-token')).status).toBe(404);
  expect((await guest('0'.repeat(32))).status).toBe(404);
  expect((await guest('not-a-token', { id: 'a', name: 'Mom', text: 'Hello' })).status).toBe(404);
  expect((await guest('0'.repeat(32), { id: 'a', name: 'Mom', text: 'Hello' })).status).toBe(404);

  // Someone invited cannot make a link before accepting; a member can turn it off, and it stops at once.
  await call(bucket, 'ana@example.test', { action: 'invite', email: 'ben@example.test' });
  expect((await call(bucket, 'ben@example.test', { action: 'link' })).status).toBe(422);
  await call(bucket, 'ben@example.test', { action: 'accept' });
  const off = await readJson<Linked>(call(bucket, 'ben@example.test', { action: 'unlink' }));
  expect(off.household!.link).toBeUndefined();
  expect((await guest(token)).status).toBe(404);
  expect((await readJson<Linked>(call(bucket, 'ben@example.test', { action: 'unlink' }))).household!.link, 'off already').toBeUndefined();
  // A new link is a new address; when the last member leaves, the link closes with the list.
  const again = (await readJson<Linked>(call(bucket, 'ana@example.test', { action: 'link' }))).household!.link!;
  expect(again).not.toBe(token);
  await call(bucket, 'ana@example.test', { action: 'leave' });
  expect((await guest(again)).status, 'one member is still in it').toBe(200);
  await call(bucket, 'ben@example.test', { action: 'leave' });
  expect((await guest(again)).status).toBe(404);
});
