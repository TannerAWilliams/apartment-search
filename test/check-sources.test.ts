import { expect, test } from 'bun:test';
import { CHECKS, checkSources, isBlocked, summary } from '../scripts/check-sources.ts';

test('each source is reported as working, blocked or broken', async () => {
  const outcomes = await checkSources(
    [
      { id: 'good', run: async () => 12 },
      { id: 'refused', run: async () => Promise.reject(new Error('Zillow returned HTTP 403.')) },
      { id: 'redfin', run: async () => Promise.reject(new Error('Redfin returned HTTP 405.')) },
      { id: 'limited', run: async () => Promise.reject(Object.assign(new Error('Slow down'), { httpStatus: 429 })) },
      {
        id: 'challenged',
        run: async () => Promise.reject(Object.assign(new Error('Compass answered with a challenge'), { code: 'bot_challenge' })),
      },
      { id: 'changed', run: async () => Promise.reject(new Error('Compass did not return a recognized rental page.')) },
      { id: 'empty', run: async () => 0 },
    ],
    () => new Response(''),
  );
  expect(outcomes.map(({ id, state }) => [id, state])).toEqual([
    ['good', 'working'],
    ['refused', 'blocked'],
    ['redfin', 'blocked'],
    ['limited', 'blocked'],
    ['challenged', 'blocked'],
    ['changed', 'broken'],
    ['empty', 'broken'],
  ]);
  expect(summary(outcomes)).toContain('| good | working | 12 listings |');
  expect(isBlocked('text')).toBe(false);
});

test('every quick source is checked, and the long complete syncs are not', () => {
  const ids = CHECKS.map(({ id }) => id);
  expect(ids).toContain('stuytown-live');
  expect(ids).toContain('westchester-homeseeker');
  for (const id of ['cityrealty-live', 'zumper-live', 'openigloo']) expect(ids).not.toContain(id);
});
