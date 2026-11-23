import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';

test('the in-memory test bucket mirrors D1 conditional writes and size limits', async () => {
  const bucket = createMemoryBucket(100);
  const first = await bucket.put('state', 'old', { onlyIf: { etagDoesNotMatch: '*' } });
  expect(await bucket.put('state', 'bad', { onlyIf: { etagDoesNotMatch: '*' } })).toBeNull();
  expect(await bucket.put('state', 'bad', { onlyIf: { etagMatches: 'wrong' } })).toBeNull();
  expect(await required(await bucket.get('state')).text()).toBe('old');
  await bucket.put('state', 'new', { onlyIf: { etagMatches: required(first).etag } });
  expect(await required(await bucket.get('state')).text()).toBe('new');
  await expect(bucket.put('large', 'x'.repeat(101))).rejects.toThrow();
  expect(await bucket.get('large')).toBeNull();
  expect(await createMemoryBucket().get('state')).toBeNull();
});
