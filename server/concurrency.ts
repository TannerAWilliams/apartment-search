/**
 * Running independent work together, a few at a time. A Worker opens at most six outgoing connections at once
 * (more wait their turn), and the sites and services read deserve a modest pace, so work over many items runs
 * through a small pool rather than all at once or one by one.
 */

/**
 * `task` for every item, at most `limit` at once, with the results in the items' order. Each finished task starts
 * the next item, so one slow item does not hold up the rest (unlike fixed batches). The first failure rejects, as
 * Promise.all does; tasks that should not stop the others catch their own errors.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
