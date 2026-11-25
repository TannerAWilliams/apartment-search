import { expect, test } from 'bun:test';
import { mapLimit } from '../server/concurrency.ts';

test('mapLimit runs at most the limit at once, keeps the order, and starts the next as each finishes', async () => {
  let running = 0;
  let most = 0;
  const started: number[] = [];
  const results = await mapLimit([30, 5, 5, 5, 5], 2, async (delay, index) => {
    started.push(index);
    running++;
    most = Math.max(most, running);
    await Bun.sleep(delay);
    running--;
    return delay * 10;
  });
  expect(results).toEqual([300, 50, 50, 50, 50]);
  expect(most).toBe(2);
  // The slow first item did not hold up the others: all of them started while it ran.
  expect(started).toEqual([0, 1, 2, 3, 4]);
});

test('mapLimit with no items does nothing, and the first failure rejects', async () => {
  expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  await expect(mapLimit([1, 2], 2, async (n) => (n === 2 ? Promise.reject(new Error('second failed')) : n))).rejects.toThrow(
    'second failed',
  );
});
