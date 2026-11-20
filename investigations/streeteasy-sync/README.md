# StreetEasy live-resync investigation

Keep StreetEasy acquisition experiments and their sanitized results in this folder.
This is an investigation, **not a working live-sync guarantee**. Production code
stays in its existing locations so imports, deployment commands and tests do not
break merely to reorganize the work.

## Goal and current status

A user clicks StreetEasy Resync in the deployed app; the app obtains current,
complete active inventory, validates it, persists it, and reports the actual
saved count and source timestamp. A first page, HTTP 200, old snapshot or passing
fixture test is not success.

As of November 13, 2026, live hosted acquisition remains unresolved. The earlier
successful development-workspace fetch and the rejected hosted requests used
different network paths. The fetching algorithm is already in this repository;
copying it does not reproduce the original network environment. No supported,
user-owned production endpoint for that successful workspace path has been
established. Do not turn development infrastructure into a public proxy or
export its credentials.

## Existing implementation map

- [Partitioned StreetEasy loader](../../server/streeteasy.ts): unfiltered active
  inventory, bounded price partitions, result-window handling and reconciliation.
- [Restricted Node relay](../../server/relay-service.ts): authenticated requests,
  response-size/concurrency/rate limits and upstream error propagation.
- [Relay request policy](../../server/relay-policy.ts): allowed request shapes and
  destinations; not a general-purpose proxy.
- [Application documentation](../../README.md#streeteasy-access-and-completeness):
  current importer and external-runner contracts.

Keep experimental work separate from these production paths until reviewed,
tested and explicitly selected for deployment.

## Recorded attempts

These entries summarize prior observations; they were not rerun to create this
document. A historical success does not establish current access.

| Date (New York) | Path | Observed result | What it establishes |
| --- | --- | --- | --- |
| Nov 12 | Development-workspace partitioned API fetch | Reported 15,935 raw unique listings; published normalized batch of 15,815 | That one fetch completed at that time; not a reusable hosting service or today's inventory |
| Nov 12–13 | Direct hosted Worker and Render relay requests | Upstream HTTP 403 | Hosted acquisition blocked; copying headers/loader did not establish access |
| Nov 13 | Browser gateway on Render | Browser challenge; memory-limit termination observed | Browser resource failure and provider challenge, not successful sync |
| Nov 13 | Hosted-browser and isolated network fixtures | Synthetic transport/containment tests passed; provider acquisition not qualified | Engineering checks only; no full live inventory |
| Nov 13 | Cloudflare Browser Run access investigation | Account connection available; subscription/free allowance not verified through available connection | No Browser Run StreetEasy result; no browser launched as part of that check |

Do not conflate Cloudflare Worker requests with Cloudflare Browser Run tests.
Do not list an unexecuted experiment as failed or passed.

## Constraints

- No spending, paid upgrades or unverified usage that could incur charges.
- No contacting StreetEasy and no historical-listing fallback as the requested fix.
- Scheduled StreetEasy refresh runs only from the owner's own computer (`scripts/install-streeteasy-schedule.sh`).
- Preserve saved inventory on a failed/incomplete refresh.
- Never commit passwords, bearer tokens, cookies, account identifiers, private
  dashboard links, environment files or raw authentication/network dumps.
- Do not change app access permissions for an experiment.

## Recording the next attempt

Add a dated Markdown file here, for example
`2026-11-14-supported-path-check.md`, before changing an acquisition path:

1. **Hypothesis and prerequisite:** why this differs from a previously failed
   attempt, and evidence that the path is supported and within the zero-cost limit.
2. **Start/end time:** actual New York times, not the scheduled automation time.
3. **Scope:** exact commit, deployment, source and expected effect; sanitize IDs
   and omit secrets.
4. **Checks:** unit/fixture tests separately from real browser/source tests.
5. **Outcome:** HTTP status, challenge/error category, raw/normalized/persisted
   counts and source freshness, where available.
6. **Completeness:** partition totals and unique-ID reconciliation; do not
   equate normalized count with raw source count.
7. **Failure behavior:** prior data unchanged, error accurately shown, bounded
   retries/cooldown respected and resources closed.
8. **Next step or stop reason:** do not repeat an unchanged failing attempt.

Prefer small synthetic fixtures in an attempt-specific subdirectory. Keep bulk
listings and screenshots containing personal or credential information out of Git.
If an executable prototype is needed, give it explicit opt-in invocation and no
automatic provider requests on module import, build or ordinary test runs.
