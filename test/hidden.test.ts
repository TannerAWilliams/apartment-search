import { expect, test } from 'bun:test';
import { exportAccount, deleteAccount } from '../server/account.ts';
import { hiddenKey, MAX_HIDDEN, readHidden } from '../server/hidden.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const call = (env: Record<string, unknown>, account: string | undefined, body?: unknown) =>
  handleApi(
    new Request(
      'https://app.test/api/hidden',
      body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    ),
    env,
    { account },
  );

test('each account keeps its own hidden apartments, once each, and they go with the account', async () => {
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket };
  expect(await readJson(call(env, 'renter@example.com'))).toStrictEqual({ keys: [] });
  const keys = ['NY|11201|12 grove st|2a', 'NY|11215|9 fifth ave|1'];
  expect(await readJson(call(env, 'renter@example.com', { keys: [...keys, keys[0]] }))).toStrictEqual({ keys });
  expect(await readHidden(bucket, 'RENTER@example.com'), 'the address is matched without case').toStrictEqual(keys);
  expect(await readJson(call(env, 'other@example.com'))).toStrictEqual({ keys: [] });
  // Too many: the newest are kept.
  const many = Array.from({ length: MAX_HIDDEN + 5 }, (_, index) => 'key ' + index);
  const kept = (await readJson<{ keys: string[] }>(call(env, 'other@example.com', { keys: many }))).keys;
  expect(kept).toHaveLength(MAX_HIDDEN);
  expect(kept.at(-1)).toBe('key ' + (MAX_HIDDEN + 4));

  // Without an account, or with a bad body, nothing is stored.
  expect((await call(env, undefined)).status).toBe(404);
  expect((await call(env, undefined, { keys })).status).toBe(404);
  expect((await call(env, 'renter@example.com', { keys: [7] })).status).toBe(422);

  // The account's export has them, and deleting the account forgets them.
  expect((await exportAccount(env, 'renter@example.com')).hiddenApartments).toStrictEqual(keys);
  await deleteAccount(env, undefined, 'renter@example.com');
  expect(await readHidden(bucket, 'renter@example.com')).toStrictEqual([]);
});

test('a damaged stored list reads as nothing hidden', async () => {
  const bucket = createMemoryBucket();
  await bucket.put(await hiddenKey('renter@example.com'), '{"keys":7}');
  expect(await readHidden(bucket, 'renter@example.com')).toStrictEqual([]);
});
