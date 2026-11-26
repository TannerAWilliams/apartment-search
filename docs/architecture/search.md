# How search works, and why

Decided November 2026, with about 18,400 listings (18 MB of stored JSON) that change once a night and a little
every two hours.

## The problem

A search needs every listing: rents are compared with similar apartments across the whole inventory, and any
filter can apply to any listing. On Cloudflare Workers, the server is many short-lived instances. Each new one
had to read all 18 MB from the database, parse, merge and score it before answering its first search: 2 to 3
seconds, measured in production (about 0.5 s waiting on the database, the rest computing). Caching answers
helped repeated searches only; a search nobody had run still paid in full.

## The options

| Option | First results | Each later filter | Cost |
|---|---|---|---|
| A. Server filters in memory (what we had) | 2–3 s on a new instance | 0.3 s warm, 2–3 s cold | none |
| B. Filter in SQL with indexed columns | about 0.3 s | a request each, about 0.3 s | the matching rules written twice (SQL for search, TypeScript for alerts), kept in agreement by hand |
| C. One always-on instance holding the listings (Durable Object) | 0.3 s when awake | a request each | one region; sleeps when idle and wakes cold, like A |
| D. A hosted search engine | about 0.2 s | a request each | a second system to feed and pay for |
| **E. Publish the scored inventory as a file; search in the browser** | **from the file's head, no listings read** | **no request at all** | a download per inventory version (measured below) |

E is chosen. The inventory is small (thousands, not millions), changes on a schedule, and the matching code was
already written to run anywhere (`src/search.ts`, `src/market.ts`). So the cheapest correct design is to do the
expensive work once, when the listings change, and let every browser reuse the result. B through D each keep a
network request in the path of every filter change; E removes it. A database index (the first idea anyone has)
does not help A: the query was 27 ms; the cost was moving and scoring the rows.

Not chosen, and why it could be revisited: at around 200,000 listings the file would pass 10 MB compressed and
a phone's memory; then B, with scores written to indexed columns at sync time, becomes the right design.

## The design

```
sync / hourly ──► readInventory ──► composeInventory ──► Workers KV
                  (merge, score)    (columnar file,      head            (version, opening answer)
                                     gzip, hash)         file:<version>  (never changes)

browser: /boot.js ──► GET /api/inventory ──► GET /api/inventory/<version>   (while the app's code downloads)
         app      ──► searchApartments(filters) ──► answerSearch(inventory, filters)   (no request)
```

- **`server/inventory.ts`** builds the file after each sync, each hour (listings age out with time alone), and
  when a deploy finds the stored one built by older code. A version is the hash of the file's contents; nothing
  is written when nothing changed.
- **Workers KV** holds it. KV is made for read-heavy values served from every Cloudflare location (hot reads in
  0.5 to 10 ms, values up to 25 MB). R2 would suit as well but is not enabled on this account; D1 would have to
  store it as base64 text in chunks.
- **`src/inventory-format.ts`** is the file: a header, then row groups of 2,000 listings stored by column with
  dictionaries for repeated text. Generic, so a new listing field needs no change.
- **`src/answer.ts`** is the one definition of a search's answer, run by the browser over the file. The server's
  search (`server/search.ts`) is kept and must agree: `test/inventory.test.ts` compares the two across a matrix of
  filters, field for field.
- **`src/inventory-client.ts`** answers in the app when it can. The opening search's answer rides in the head,
  so a first visit shows apartments before the file has arrived.
- **The server still searches** for what the file does not cover: the phone app's official-only search, saved
  (non-live) inventory, routed commute limits, alerts and digests, and any browser that could not get the file.

## What is in the file, and what is not

Everything a search and a card use. Left out: each listing's price history and two bookkeeping fields.

An apartment's own page takes the listing from the file too. It also asks the server for the listing as stored
(`GET /api/listing/stored`: one lookup by ID on an index, migration 0005, with no other listing read). That
copy carries the price history, and on a shared link it is requested by `/boot.js` and shown first, before the
file has arrived; the comparisons with other listings appear when it does.

## Who can read the file

Only the app's own pages. The file route requires the `Sec-Fetch-Site: same-origin` header, which browsers set
and a page's script cannot: another website cannot fetch the file through its visitors, and a plain download is
refused. It is also rate-limited per visitor. This is a deterrent, not secrecy: the browser must be able to read
the file, so someone who forges the header can as well, as they could always read search results page by page.
A browser too old to send the header (Safari before 16.4) searches through the server instead.

## The page itself

The HTML and the app's code are static, so Cloudflare serves them from its edge without starting the Worker
(`run_worker_first` lists only the API and the pages the Worker renders). Their security headers come from
`web-build/_headers`, written at build time from the same definition the Worker uses (`server/web-headers.ts`).
An address that is not a file is the app's page, which routes it.

## Freshness

The head is cached for 30 seconds; a version's file forever. A page left open asks for the head again every
five minutes and takes a newer file when there is one. After a sync, the file is rebuilt in the same run.

## Keeping it fast

`bun run perf` budgets building the file, decoding it, a browser's search over it, and its compressed bytes per
listing. `e2e/perf.spec.ts` asserts that, with the file, results and a filter change make no search request.
