# Performance

How Walkup is kept fast: what is measured, where the limits live, and what to do when a check fails.

## The checks

Every pull request and every push to main runs these in CI. A failure stops the deploy.

| Check | Command | What it catches |
|---|---|---|
| Async lint | `bun run lint` | A promise nobody waits for; `await` in a loop in website code (the sync is exempt); barrel files that drag unused code into a bundle. Rules in `biome.json`. |
| Speed budgets | `bun run perf` | A server path that got slower, stopped scaling with the data, returns more bytes, or keeps more memory. `perf/bench.ts`, against 20,000 seeded listings on the production schema. |
| Size budgets | `bun run perf:bundle` | A bigger first download, a map library in it, a lazily loaded file that grew, a bigger Worker script. `perf/bundle.ts`. |
| Request budgets | `e2e/perf.spec.ts` (with the browser tests) | A page that makes more requests than before, a search that waits for the settings, a tap that costs more than one request. |

After each deploy, `bun run perf:live` (the `speed` job in `.github/workflows/deploy.yml`) times the live site in a
fresh phone browser profile. It cannot block a deploy that already happened; a red run is the alarm.

All limits are in `perf/budgets.json`, which is reviewed like code.

## The four kinds of budget

- **Time.** Each scenario's fastest run, divided by a fixed calibration workload timed in the same process, so a
  number means the same on a laptop and on a CI machine. Timings on shared machines wander by about a third, so a
  budget is the slowest of three passes and a check fails only when a scenario is over by more than 50% in three
  passes running. This catches a path that became about half again slower or worse.
- **Scaling.** The same scenario with a quarter of the listings: four times the data may take at most eight
  times as long. It needs no baseline, so it does not wander, and a quadratic loop (sixteen times) always fails.
- **Sizes.** Bytes of a search response, of the map's points per listing, of the app settings.
- **Memory.** What a cold search keeps on the heap. A Worker has 128 MB.

Counts (requests, bytes, scaling) are exact; prefer adding one of those over a time budget when either would do.

## When a check fails

1. Read the failure: it names the scenario and how far over it is. `bun run perf` prints the whole table.
2. Find the cause: `bun --cpu-prof perf/bench.ts` writes a CPU profile (open it in Chrome's developer tools,
   Performance tab), or compare the pure steps (`merge-listings`, `score-listings`, `match-listings`) to see which moved.
3. Fix it. If the slowdown is the price of something wanted, run `bun run perf:update`, and commit
   `perf/budgets.json` with the reason in the commit message.

## Production

- **Server-Timing.** Every search response says where its time went (`status`, `cache`, `read`, `score`, `facts`,
  `open-data`, `destination`): in the browser's developer tools, Network tab, the request's Timing section. In a
  Worker the clock only moves while the code waits (database, network), so the phases show waiting, not computing.
- **Slow searches** over one second are logged as `slow_search` with their phases (Workers Logs).
- **Real visits** report Core Web Vitals as `web_vital` (`src/web-vitals-report.ts`).
- `bun run perf:lighthouse` runs a Lighthouse audit against a local server.

## How the server stays fast

- One set of listings per Worker instance: every listing is read, merged and scored once, kept for fifteen
  minutes (or until a sync changes it), and every search, apartment page and neighborhood page filters that set
  in memory. Alerts read the database each time, because they decide what changed.
- A search's answer is also kept in Cloudflare's cache per data center, written after the response is sent.
- Transit estimates are remembered per destination and home, so a person's later searches reuse them.
- Independent reads run together (`Promise.all`); work over many items goes through `mapLimit`
  (`server/concurrency.ts`), a rolling pool with a limit; bookkeeping runs after the response (`afterResponse`).
- The sync runs one source at a time, by choice: no site sees two readers at once.

## Known costs, and what would remove them

Measured in November 2026 with 18,400 listings (18 MB of stored JSON):

- **A Worker instance's first search takes 1.5 to 2.5 seconds**: about 0.5 s waiting on the database and about
  1 s of computing (parsing 18 MB, scoring). It is paid once per instance per fifteen minutes. Removing it means
  a compact search index written at sync time (only the fields matching and cards need), so a cold instance
  parses a few megabytes instead of all of it. That is the next structural step if cold starts matter more.
- **The map's points are about 450 bytes per listing** (9 MB uncompressed for every listing), because each
  carries what saving from the map needs. Sending position, rent and ID only, and reading the rest when a pin is
  opened, would cut it to about a fifth. The size budget stops it growing meanwhile.
- **The Worker script is 3.4 MB** (1.1 MB compressed): about 2 MB is the sign-in library and its database layer,
  0.7 MB the bundled fallback snapshot. Every new instance parses it before answering.
