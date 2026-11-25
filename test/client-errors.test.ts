import { expect, test } from 'bun:test';
import { CLIENT_ERRORS_KEY } from '../server/routes/client-errors.ts';
import { handleApi } from './fixtures/api.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const send = (env: Record<string, unknown>, body: unknown) =>
  handleApi(
    new Request('https://app.test/api/client-error', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    env,
  );

test('a crash in the browser is kept, the latest 30, so it can be found', async () => {
  const bucket = createMemoryBucket();
  expect((await send({ BUCKET: bucket }, { message: 'x is undefined', stack: 'at Alerts', path: '/alerts' })).status).toBe(204);
  for (let index = 0; index < 31; index++) await send({ BUCKET: bucket }, { message: 'crash ' + index, stack: 'a'.repeat(3000) });
  const kept = (await (await bucket.get(CLIENT_ERRORS_KEY))!.json()) as { message: string; stack: string; at: string }[];
  expect(kept).toHaveLength(30);
  expect(kept[0]?.message).toBe('crash 30');
  expect(kept[0]?.stack).toHaveLength(1500);
  // Without storage it is only logged; a malformed report is refused.
  expect((await send({}, { message: 'no storage' })).status).toBe(204);
  expect((await send({ BUCKET: bucket }, 'nope')).status).toBe(400);
  await bucket.put(CLIENT_ERRORS_KEY, 'not json');
  expect((await send({ BUCKET: bucket }, { message: 'after damage' })).status).toBe(204);
});
