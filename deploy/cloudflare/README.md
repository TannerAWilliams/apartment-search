# Cloudflare deployment

The Worker serves the Expo web app with Workers Static Assets. The existing API reads and writes D1 through the shared bucket interface. The Cloudflare entrypoint uses direct provider requests, so it does not require the Render listing relay.

Build with Bun 1.4.4.

```sh
bun install --frozen-lockfile
bun run build:web
mkdir -p dist/cloudflare
bun build deploy/cloudflare/private.ts --target=node --format=esm --minify --external cloudflare:workers --outfile=dist/cloudflare/private.mjs
```

Apply `schema.sql` to the D1 database. Bind it as `APARTMENTS` and bind `web-build` as `ASSETS`. Enable `nodejs_compat`, route all requests through the Worker to protect assets and API requests, and use `private.mjs` as the entrypoint with an `APP_ACCESS_TOKEN` secret for staging.

Bind the listing refresh Workflow as `CITYREALTY_SYNC` with workflow name `apartment-cityrealty-sync` and class `CityRealtySync`. The legacy binding also serves Openigloo and Zumper. Keep its concurrency at one. The app persists the active Workflow ID in the existing D1 bucket, so an interrupted browser session does not start another crawl or lose the job. There is no new D1 schema migration.

The two `apartment_object*` tables implement the app's versioned snapshot storage with transactional compare-and-swap, and are the only tables. Each source's snapshot holds its current listings and their price history only; nothing keeps records of past listings. (The earlier `rental_listing_*` and `source_observations` tables were dropped on 2026-11-20.) Keep a saved snapshot's original observation timestamp during a migration so the frontend can label its freshness correctly.

## Refresh rollout checklist

- Check for active or queued instances of the existing Workflow before switching versions. Time-bucket IDs from the old Worker are not registered in D1; wait for any such jobs to reach a terminal state before accepting refreshes on the new build.
- Compare routes, bindings, CPU limits, and observability with the running Worker before deploying. Preserve the existing access policy and StreetEasy pause. Do not treat the checked-in Wrangler limits as approval to increase the live CPU limit or enable logs.
- In an isolated test, start Openigloo, check the recorded job ID after four minutes, reload the app, and verify the same run remains visible. Verify the source timestamp advances only when a successful import is published. An incomplete run must retain the previous snapshot.
- There is no Cloudflare cron in this release. Before adding one, qualify checkpointed batches under the intended plan's [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/) and provider pacing. A schedule alone does not make a full run fit the Free plan. If the account is already on Workers Paid, verify its current limits and remaining headroom and measure a representative authorized run before deciding whether Free-plan sharding is needed. Provider subrequests are not separately billed as Workflow invocations, but [other Workflow charges and limits still apply](https://developers.cloudflare.com/workflows/reference/pricing/).

## Recover a definitively missing refresh instance

An unknown status is not proof that a Workflow stopped. If a confirmed run was deleted or its terminal state aged out before it could be recorded, the app deliberately keeps its ID and blocks replacement long jobs. Never clear this lock merely because it is old or the app cannot reach Cloudflare.

Only an authorized Cloudflare operator should do the following; nothing in the app calls this runbook:

1. Read the one registry object and its body in the same D1 query:
   ```sql
   SELECT h.etag, p.body
   FROM apartment_objects AS h
   JOIN apartment_object_parts AS p ON p.key = h.key AND p.etag = h.etag AND p.part = 0
   WHERE h.key = 'rentals/complete-refresh-workflow.json' AND h.part_count = 1;
   ```
   If there is not exactly one result, stop and inspect rather than guessing. Decode the body from base64 to JSON, confirm the exact job ID and current stored state, and save that ETag and original base64 body. This recovery is for a previously confirmed, nonterminal instance, not an unconfirmed start or a record already marked terminal.
2. In the Cloudflare dashboard or the authenticated [Workflow instance read API](https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/get/), verify the **same account, Workflow and exact instance ID**. If it still exists in any active state, do nothing. If it is terminal, let the app record the existing outcome. Only proceed if definitive evidence shows the exact instance is gone. A bare 404, permission error, timeout, unverified account/Workflow or ambiguous response is not sufficient. Do not concurrently create, restart or manage that instance out of band.
3. With a D1 interface that supports bound parameters, run [the guarded reconciliation statement](reconcile-workflow.sql) with the captured ETag and original base64 body. A zero-row result means the registry no longer matches: stop and recheck, rather than relaxing the guard. One affected row clears only the registry header. The old part is invisible to the bucket reader and the next normal reservation replaces it atomically. Never delete the whole table, the source inventory, or its freshness state.
4. Verify the registry is clear before deciding whether to request a new refresh through the usual UI. Reconciliation alone never imports data or starts a job, and it does not mark the previous run successful.

The statement is exercised against the checked-in D1 schema using local SQLite; this runbook has not been executed against production.
