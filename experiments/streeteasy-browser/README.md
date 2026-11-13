# StreetEasy browser-session experiment

**Not deployed, not a proven CAPTCHA solution, not connected to the app button.**
This isolated prototype does not change the production Node relay or its working
HotPads flow. It creates one browser context and executes supported API queries
inside its StreetEasy page. Cookies and browser state stay inside that process.

## Verified and unverified

Unit tests exercise session reuse, challenge pause, canceled queued requests,
closing during startup, request/action validation, and authenticated gateway behavior.
TypeScript checking passes. These are mock-driver tests, not a successful live crawl.
The actual cloud Chromium launch failed before navigation because Unix sockets
were not permitted. No browser security feature was disabled to work around it.

A critical unresolved limitation remains: a CAPTCHA returned to an API `fetch`
is not necessarily displayed in the top-level page. Screenshot and action controls
can interact with an actual challenge on that page but do not fabricate a challenge,
replay challenge tokens, or establish that the API challenge can be solved.
The `/browser/resume` response always says `complete: false`; only the application's
existing full-count reconciliation can establish complete listing ingestion.

## Run only in a permitted, isolated environment

Use Node22.13+ and a compatible Chromium with its sandbox enabled. Install pinned
dependencies with `npm ci`, then install the matching official browser using
`npx playwright install chromium` when the machine permits it. The executable can
instead be selected with `CHROMIUM_EXECUTABLE_PATH`. Do not use `--no-sandbox`.
Run `npm test` and `npm run typecheck` first. Supply `LISTING_RELAY_TOKEN` via the
host's secret store, never a command argument, file or frontend script, then `npm start`.

The gateway is server-to-server, not a public browser UI:
- `GET /health` exposes liveness only.
- Every other operation requires the relay bearer secret.
- `POST /fetch` accepts only the existing fixed StreetEasy relay request shape.
- `GET /browser/status` reports state, never cookies or page contents.
- `GET /browser/screenshot` returns a bounded screenshot from the real session.
- `POST /browser/action` permits bounded clicks, short text, or Enter/Tab/Backspace.
- `POST /browser/resume` is an explicit owner request to retry the current session.
- `POST /browser/close` closes it; restart the process to create a new session.

The current app would need authenticated server-side wrappers and a private
challenge interface before exposing these controls to its owner. Do not put the
relay secret in a web page. Do not point the production mixed-provider relay URL
at this experiment: it implements StreetEasy only.

## Safety and runtime limits

The context blocks downloads, new pages, service workers and all WebSockets;
only fixed HTTPS StreetEasy and known challenge-asset domains are allowed by the
browser route guard. This is application defense-in-depth, not an OS egress sandbox.
API403/429/challenge text pauses later queries rather than retrying automatically.
A session expires after10minutes. Queue size is bounded, API responses are limited
to8MiB and screenshots to1MiB. The gateway permits120operations/minute; these bounds
are not proof of zero infrastructure cost.

Before any Render deployment, verify current free-tier spending controls, browser
sandbox compatibility and memory use. The512MiB free instance and transient disk
have not been tested with this browser. A successful first page is not sufficient:
run the actual app button, finish all partitions, verify unique counts and saved
records, and separately test aborts, challenge pauses and cold starts.
Provider access and permissions still apply. There is no guaranteed full StreetEasy
refresh or automatic CAPTCHA solver here.

## November 13 access diagnostic

A separate sandbox-enabled Chromium probe ran on Render's build host. The
StreetEasy top-level rental page returned HTTP403 before any explicit API query.
No recognized CAPTCHA element was present at that immediate observation; this
is not proof a delayed challenge could never render. No CAPTCHA was solved and
no inventory was obtained. The production Node relay independently returned403.
Build-host browser startup is now demonstrated, but browser memory/sandbox behavior
on the free runtime instance remains unverified.

The prototype now pauses on a403/429 main document even when no challenge selector
is visible. It retains that browser for authenticated screenshot/owner actions,
but will not issue an API query while the document remains blocked. Resume requires
a subsequent successful document navigation and no recognized challenge. This is
fail-closed behavior, not a bypass or a guarantee that the provider will grant access.


## Bounded interception and owner rechecks (draft)

All HTTP redirects, including allowed-to-allowed redirects, fail closed before
Location reaches the browser. Browser requests are intercepted using streaming
Node fetch with `redirect: manual`, not untouched native-browser transport.
Original browser request headers/cookies remain internal and are sent only to the
exact allowlisted destination. Set-Cookie responses return to that browser context;
no cookie export API or token replay exists. Actual browser cookie behavior remains
to be qualified. Legitimate redirects may require policy review, not automatic retry.

Network resource limits now apply **before** full buffering:
-2MiB decoded bytes per response,64KiB request bodies;
-two active requests, four queued requests; excess requests fail closed;
-12second active-request deadline and32MiB aggregate received-byte budget;
-close cancels active streams and queued requests; no automatic network retries.
Response copies and browser allocations still consume additional memory. These
are bounded transport budgets, not proof that Chromium fits a512MiB free runtime.
Browser script allocation, DNS-level isolation, actual resource scheduling and
sandbox startup still require runtime qualification.

An authenticated explicit resume performs one fixed rental-page navigation in
the same context. Initial document failures and API403/429 set a minimum60second
delay; Retry-After captured from browser response events can extend it, even when CORS
hides that header from page JavaScript. Missing/non-2xx documents and
visible challenges remain blocked. No background retries or provider calls happen
at startup. API access may independently fail after a page succeeds.

Startup launches and closes sandboxed Chromium without provider access before
listening. A failed launch cannot present a healthy HTTP endpoint. This preflight
has not been run on the free Render runtime. Unit regressions cover redirects,
stream cancellation, request/response limits, concurrency/queue/session budgets,
internal cookie/header transfer, and resume failures. These are not real-browser
or provider qualification. No production deployment or full StreetEasy crawl has
been completed by this experiment.

## Provider-free real-browser qualification

`npm run test:browser` launches sandboxed Chromium and uses only synthetic
intercepted responses. It checks real cookie/session propagation, CORS credentials,
redirect rejection and blocked destinations. No StreetEasy request is sent: the
injected transport returns fixtures rather than calling fetch. It is separate
from default unit tests so an unavailable browser cannot silently look like a pass.
Run on a permitted host with the pinned official Playwright Chromium installed.
Passing on a build host does not establish512MiB runtime capacity or live provider
access. Latest local preflight still fails before navigation with Unix socket EPERM;
no sandbox setting was weakened to bypass that restriction.

## Runtime evidence and capacity follow-up

On November13, both provider-free real-Chromium fixtures passed on the actual
Free Render runtime: cross-origin HttpOnly cookies/CORS and redirect isolation.
One live page attempt then returned403 and paused before the listing API query.
Screenshot retrieval failed and the runtime restarted. Memory metrics reached
approximately504MiB against a512MiB limit; no explicit OOM event was returned.
This is evidence of capacity pressure, not a successful refresh.

The next capacity iteration uses an800x600 viewport, bounded JPEG screenshot and
64MiB renderer V8 old-space cap, with the Chromium sandbox/site isolation intact.
The heap flag is not a whole-process memory guarantee. Runtime fixture tests now
exercise screenshot capture too. No automatic provider retry is added.

The reduced-memory version captured a real same-session StreetEasy “Press & Hold”
challenge successfully (HTTP403 remained; no listing API query). The authenticated
owner action surface now accepts an explicit bounded hold: coordinates inside the
800x600 viewport and100–10000ms, with mouse-up in a finally block. This is only a
manual/owner-authorized challenge interaction; no solver loop or automatic holds
are triggered by a listing request.

After a further live challenge interaction restarted the runtime, a final bounded
capacity iteration reduces transport limits to2MiB/resource,32MiB/session and two
active/four queued operations, and caps Node old-space at64MiB as well. Authenticated
service logs record only process memory totals and crash/disconnect events, not
headers, URLs, tokens or page contents, to distinguish Node from browser pressure.
Larger resources fail closed; these tighter limits may reduce provider compatibility.
