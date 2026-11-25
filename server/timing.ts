/**
 * Where a request's time went, by phase: sent to the browser as a Server-Timing header (shown in its developer
 * tools, under the request's Timing tab) and logged when the request was slow, so a slowdown in production names
 * its own cause. In a Worker the clock only moves when the code waits on something (a database read, a fetch),
 * so a phase's time is its waiting, which is what makes a request slow there; pure computation reads as 0.
 */
export type Timings = ReturnType<typeof createTimings>;

export function createTimings(clock: () => number = () => performance.now()) {
  const started = clock();
  const phases: { name: string; ms?: number; note?: string }[] = [];
  return {
    /** Runs the work and records how long it took under this name (added up when a name repeats). */
    async span<T>(name: string, work: () => Promise<T>): Promise<T> {
      const from = clock();
      try {
        return await work();
      } finally {
        const known = phases.find((phase) => phase.name === name);
        if (known) known.ms = (known.ms ?? 0) + (clock() - from);
        else phases.push({ name, ms: clock() - from });
      }
    },
    /** Records a fact about the request, such as a cache hit. */
    note(name: string, note: string) {
      phases.push({ name, note });
    },
    total: () => clock() - started,
    /** The phases as `{ name: milliseconds }`, with notes as text, for a log line. */
    fields() {
      return Object.fromEntries(phases.map(({ name, ms, note }) => [name, note ?? Math.round(ms ?? 0)]));
    },
    /** The Server-Timing header's value: `cache;desc="miss", read;dur=812.4, total;dur=903.1`. */
    header() {
      return [...phases, { name: 'total', ms: clock() - started }]
        .map(({ name, ms, note }) => name + (note ? `;desc="${note}"` : '') + (ms === undefined ? '' : `;dur=${ms.toFixed(1)}`))
        .join(', ');
    },
  };
}

/** Runs the work under a span when timings are being kept, and plainly otherwise. */
export const timed = <T>(timings: Timings | undefined, name: string, work: () => Promise<T>) =>
  timings ? timings.span(name, work) : work();
