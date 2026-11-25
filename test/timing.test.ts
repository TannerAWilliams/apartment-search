import { expect, test } from 'bun:test';
import { createTimings, timed } from '../server/timing.ts';

test('timings record each phase, add repeats together, and write a Server-Timing header', async () => {
  let now = 0;
  const timings = createTimings(() => now);
  const step = (ms: number) => async () => {
    now += ms;
    return ms;
  };
  expect(await timings.span('read', step(800))).toBe(800);
  await timings.span('read', step(12.5));
  timings.note('answer', 'computed');
  await expect(
    timings.span('score', async () => {
      now += 30;
      throw new Error('failed');
    }),
  ).rejects.toThrow('failed');
  expect(timings.fields()).toEqual({ read: 813, answer: 'computed', score: 30 });
  expect(timings.total()).toBe(842.5);
  expect(timings.header()).toBe('read;dur=812.5, answer;desc="computed", score;dur=30.0, total;dur=842.5');
});

test('timed runs the work plainly when no timings are kept', async () => {
  expect(await timed(undefined, 'read', async () => 7)).toBe(7);
  const timings = createTimings();
  expect(await timed(timings, 'read', async () => 8)).toBe(8);
  expect(Object.keys(timings.fields())).toEqual(['read']);
});
