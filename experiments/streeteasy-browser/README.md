# StreetEasy same-session browser experiment

**Deployed only as an isolated experiment. Not connected to production Resync,
not a proven CAPTCHA solution, and not ready to merge.** Production cache and the
existing mixed-provider relay remain unchanged.

## Qualification result: November 13, 2026

- 27 unit/mock tests and strict TypeScript checking pass.
- Two provider-free, sandboxed Chromium fixture tests passed on the actual Free
  Render runtime: cookie/CORS propagation, screenshot and mouse hold/release,
  redirect rejection, and forbidden-destination isolation.
- The real StreetEasy rental page returned HTTP 403 and displayed a Press & Hold
  challenge. Same-session screenshots succeeded after the viewport/JPEG change.
- An explicitly authorized eight-second hold returned HTTP 502 and the runtime
  restarted. No evidence establishes that the challenge passed.
- Final tighter-memory build `6bf1300` deployed at 3:06:09 p.m. New York time.
  Its one live qualification attempt again returned 403, screenshot 200, then hold
  502 and screenshot 502. The runtime restarted at 3:09:29 p.m.
- Earlier aggregate memory samples approached 504 MiB of a 512 MiB limit. Final
  samples and Node RSS were much lower; no explicit OOM or crash cause was returned.
  Capacity pressure is a hypothesis, not a confirmed diagnosis.

**No listing API request succeeded; no complete inventory was ingested.** Stop
repeating this Free Render/browser approach without materially new evidence.
A different runtime or owner-controlled browser path needs separate qualification.
Passing synthetic tests does not establish provider access or complete coverage.

## Run and test

Use Node 22.13+ and pinned dependencies: `npm ci`, then
`npx playwright install chromium`. Run `npm test`, `npm run typecheck`, and
`npm run test:browser`. The latter launches real sandboxed Chromium with synthetic
intercepted responses only, not provider requests. A local sandbox can reject
Unix sockets before navigation; do not disable Chromium sandbox/site isolation.

Supply `LISTING_RELAY_TOKEN` through the host secret store, never a command
argument, tracked file or frontend. `npm start` performs a provider-free Chromium
launch/close preflight before listening. No provider requests happen at startup.
The Free Render experiment has auto-deploy disabled.

## Server-to-server interface

Only `GET /health` is public. All other endpoints require the relay bearer:

- `POST /fetch`: fixed existing StreetEasy request shape.
- `GET /browser/status`: session state, never cookies or page content.
- `GET /browser/screenshot`: bounded image from the actual session.
- `POST /browser/action`: bounded click/type/key or 100–10000 ms hold, only while
  challenged. Hold coordinates must fit the 800×600 viewport; mouse-up runs in
  a finally block. No automatic challenge-solving loop.
- `POST /browser/resume`: explicit same-context rental-page navigation, subject
  to at least 60 seconds and provider Retry-After. Still reports `complete:false`.
- `POST /browser/close`: dispose session; restart required for a new session.

The production app would need authenticated server wrappers and a private owner
challenge surface. Do not expose the bearer in browser code or point the entire
mixed-provider relay at this StreetEasy-only experiment.

## Bounds and limitations

Browser sandbox and site isolation stay enabled. Downloads, extra pages, service
workers and WebSockets are blocked. Fixed HTTPS StreetEasy/challenge hosts are
allowlisted. All redirects fail closed, including legitimate allowed-to-allowed
redirects. This is defense in depth, not an OS egress sandbox.

Transport uses streaming **Node fetch**, not untouched native Chromium networking.
Browser headers/cookies remain internal and are sent only to the exact allowed URL;
Set-Cookie returns to the browser. There is no cookie-export endpoint or token replay.
Limits: 2 MiB decoded/resource, 32 MiB/session, 64 KiB request, two active/four queued
network operations, 12-second active deadlines. These may reject legitimate provider
resources and do not guarantee a complete crawl.

Session lifetime is ten minutes, session queue six, API response eight MiB,
screenshot one MiB. Screenshot is 800×600 JPEG quality40. Node and renderer V8
old-space caps are 64 MiB each, not whole-process memory limits. Numeric Node memory
logs do not include the whole Chromium process tree. HTTP operations are bounded;
no secret headers, tokens or page content are intentionally logged.

403/429 or recognized challenge pauses queries. Resume requires a successful main
document and no recognized challenge; the API may still independently deny access.
Completeness must be proven through all partitions, unique counts and persisted
records using the real app button. None of those end-to-end gates has passed here.

## Hosted memory-offload qualification (not deployed)

An optional `BROWSERLESS_TOKEN` enables the fixed Browserless native Playwright
endpoint, using compatible client 1.64.1. It is **memory offload only**: the bounded
transport still executes in the Node host, not Browserless provider egress.
Remote startup validates configuration without opening a session or using units.
Explicit operations have a 110-second deadline, no automatic reconnect/fallback,
and sanitized connection/cleanup failures. Token belongs only in a secret store.
Run the provider-free fixture explicitly to qualify the hosted connection; do not
put it in remote-mode startup. Health alone means configured, not qualified.

The owner subsequently reported Render's explicit 'exceeded its memory limit'
notification for apartment-browser-gateway. This confirms a gateway memory-limit
event, without assigning that cause to every independent restart above.

Hosted controllers additionally gate live endpoints on one explicit authenticated
`POST /browser/qualify` per process. It runs the synthetic fixture with a 110-second
child deadline. Startup/health never trigger it. Failure stays failed; success
allows existing guarded requests. Restart loses qualification and requires an
explicit new test. The free 1,000-unit allowance is finite; do not schedule this
endpoint. Native WebSocket tests in the current local workspace failed DNS
`EAI_AGAIN` before a session; HTTPS reachability alone does not qualify them.

## Hosted result, November 13 at 3:35 p.m. New York time

The Free Render hosted controller deployed commit ff2bb7c at 3:32:38 p.m.
Its explicitly requested remote synthetic qualification passed (HTTP 200).
One authorized live session returned403 and a valid screenshot of Press & Hold.
One authorized eight-second hold request hit the client's20-second timeout;
subsequent screenshots showed processing, then explicitly **Please try again**.
The controller stayed alive around169MiB RSS, unlike the local-Chromium attempt.
The session was closed (HTTP200, state closed) without another hold or API retry.

This qualifies memory offload, not provider access. The native hosted transport
remains a separate design question: current guard sends provider HTTP through
Render's Node fetch. No complete inventory or production Resync success occurred.
