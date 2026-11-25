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

## How search stays fast

Searches are answered in the browser from a file the server publishes when the listings change
(`docs/architecture/search.md`). A filter, a sort, a page or the map costs no request.

- The file is built after each sync and each hour, stored in Workers KV, and downloaded once per version.
- `/boot.js` starts the settings, the file's head and the file itself while the app's code downloads.
- The opening search's answer comes with the head, so first results do not wait for the file.
- The server's own search remains for alerts, the phone app and browsers without the file. There, one set of
  listings is kept per Worker instance for fifteen minutes, and answers are kept in Cloudflare's cache.
- Independent reads run together (`Promise.all`); work over many items goes through `mapLimit`
  (`server/concurrency.ts`); bookkeeping runs after the response (`afterResponse`).
- The sync runs one source at a time, by choice: no site sees two readers at once.

## Known costs

- **An apartment opened from a link** (not from a card) is read by the server, which loads every listing on a
  new instance: 2 to 3 seconds. A lookup by ID in the database would remove that.
- **The server's fallback search** on a new instance still takes 2 to 3 seconds; browsers with the file never
  use it.
- **The Worker script is 3.4 MB** (1.1 MB compressed): about 2 MB is the sign-in library and its database layer,
  0.7 MB the bundled fallback snapshot. Every new instance parses it before answering.
