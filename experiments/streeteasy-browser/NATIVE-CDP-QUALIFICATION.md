# Native CDP path: development only

The hosted Playwright experiment still sends source HTTP through Render's Node
fetch. Moving its browser to Browserless solved memory pressure, not the HTTP403.
The proposed replacement makes Chromium own HTTP and uses documented CDP Fetch
interception. It is not connected to the controller or production Resync.

Current modules are independently reviewed logic prototypes, not a qualified
security boundary:

- `native-cdp-connection.ts`: flattened command/session correlation, bounded
  pending commands/frames, fail-closed local transport on cancellation or error.
- `native-target-barrier.ts`: paused-target admission and ordered guard setup
  before resume; deny unexpected targets and stop on detach/setup failure.
- `native-http-guard.ts`: request admission, redirect rejection, bounded response
  streams and terminal cleanup. Its decoded-stream contract is not yet proven.

## Required actual adapter and fixture evidence

Use one raw CDP owner, not competing Playwright Fetch interception. Install event
listeners and root auto-attach before creating the owned about:blank target;
retain early paused attach events until the trusted createTarget result identifies
that target. Isolate its browser context. Recursively pause supported child
frames; deny workers, service workers, popups and unknown targets before resume.

Qualify with controlled HTTP/HTTPS and WebSocket fixture endpoints that count
requests at the destination. Injecting responses alone cannot establish that a
forbidden destination received no traffic. Required cases:

1. Initial page, nested cross-origin iframe and early worker request escape.
2. Allowed/forbidden redirect destinations, WebSocket and popup attempts.
3. Cookies including repeated Set-Cookie headers, CORS and HTTP authentication.
4. gzip/br decoded stream behavior, chunked overflow and header/body mismatch.
5. HEAD/204 and response-error cases; unavailable request-body size fails closed.
6. Identical Fetch IDs across different sessions, detach during read and late ack.
7. Stalled read/cleanup, command abort and complete remote browser teardown.
8. Remote110-second expiry; no automatic reconnection or provider retries.

Socket closure stops new local commands but is not proof that remote targets
stopped. Teardown must be observed independently. Do not remove Content-Encoding
until decoded byte behavior is demonstrated. Do not use private Playwright fields,
disable browser sandboxing or claim all-target coverage from mock tests.

Only after these gates and independent review may a bounded explicitly authorized
provider attempt run. A successful page or HTTP200 still does not prove a complete
StreetEasy crawl or persisted application data. Production configuration and
cached listings remain unchanged throughout this development stage.
