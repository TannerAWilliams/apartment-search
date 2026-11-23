// Runs the built Worker in Cloudflare's own runtime (workerd, through `wrangler dev`) and calls its main
// routes. Unit tests run under Bun; this catches what only the production runtime rejects.
//   bun run build:web && bun run test:workerd

const PORT = 8790;
const origin = `http://127.0.0.1:${PORT}`;
const wrangler = ['./node_modules/wrangler/bin/wrangler.js', '-c', 'deploy/cloudflare/wrangler.jsonc'];

const PLACEHOLDER_EMAIL = 'smoke-test@example.com';

/** A route, the request to send, and what a working Worker answers. */
const CHECKS: { path: string; init?: RequestInit; status: number; contains?: string }[] = [
  { path: '/health', status: 200, contains: 'ok' },
  { path: '/', status: 200, contains: '<div id="root">' },
  { path: '/manifest.webmanifest', status: 200, contains: 'Apartment Search' },
  { path: '/data/streeteasy-dashboard-2026-11-17.zip', status: 404 },
  { path: '/api/config', status: 200, contains: '"storageMode":"persistent"' },
  { path: '/api/refresh', status: 200 },
  // Better Auth in workerd with D1: a session check, and a code request for an email that may not sign in,
  // which is answered like any other but sends nothing (this run has no email binding).
  { path: '/api/auth/get-session', status: 200, contains: 'null' },
  {
    path: '/api/auth/email-otp/send-verification-otp',
    status: 200,
    contains: '"success":true',
    init: { method: 'POST', body: JSON.stringify({ email: 'not-allowed@example.com', type: 'sign-in' }) },
  },
  { path: '/api/alerts', status: 200, contains: '"rules":[]' },
  { path: '/api/dashboard', status: 200, contains: '"files"' },
  { path: '/api/dashboard?file=rentalIndex_All.csv', status: 200, contains: '"months"' },
  { path: '/api/search', status: 200, contains: '"matches"', init: { method: 'POST', body: JSON.stringify({ region: 'brooklyn' }) } },
  {
    path: '/api/vitals',
    status: 204,
    init: { method: 'POST', body: JSON.stringify({ page: 'results', metrics: [{ name: 'LCP', value: 900, rating: 'good' }] }) },
  },
  {
    path: '/api/search',
    status: 422,
    contains: 'Choose a supported region',
    init: { method: 'POST', body: JSON.stringify({ region: 'mars' }) },
  },
  {
    path: '/api/search',
    status: 400,
    contains: 'Send a JSON request',
    init: { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } },
  },
  {
    path: '/api/refresh',
    status: 200,
    contains: 'already_checked',
    init: { method: 'POST', body: JSON.stringify({ check: 'now', sessionStart: true }) },
  },
  { path: '/api/config', status: 405, init: { method: 'POST', body: '{}' } },
  { path: '/api/unknown', status: 404, contains: 'Endpoint not found' },
];

async function waitForWorker(deadline: number) {
  while (Date.now() < deadline) {
    try {
      if ((await fetch(origin + '/health')).ok) return;
    } catch {
      /* not listening yet */
    }
    await Bun.sleep(500);
  }
  throw new Error('wrangler dev did not start within 90 seconds.');
}

if (import.meta.main) {
  // The local D1 database with the production schema, from the same migrations the deploy applies.
  const schema = Bun.spawnSync(['node', ...wrangler, 'd1', 'migrations', 'apply', 'apartment-search-observations', '--local']);
  if (schema.exitCode !== 0) throw new Error('Could not create the local database:\n' + schema.stderr.toString());
  // Sign-in rate limits and codes from an earlier run would refuse this run's requests.
  const reset = Bun.spawnSync([
    'node',
    ...wrangler,
    'd1',
    'execute',
    'apartment-search-observations',
    '--local',
    '--command',
    'DELETE FROM "rateLimit"; DELETE FROM "verification";',
  ]);
  if (reset.exitCode !== 0) throw new Error('Could not reset the local sign-in tables:\n' + reset.stderr.toString());
  // Wrangler runs on Node, its supported runtime; it runs the Worker in workerd.
  const worker = Bun.spawn(
    [
      'node',
      ...wrangler,
      'dev',
      '--var',
      'PUBLIC_APP:true',
      '--var',
      `ACCESS_ALLOWED_EMAILS:${PLACEHOLDER_EMAIL}`,
      // Email-code sign-in (Better Auth) on, checking the browser's origin against this local one.
      '--var',
      'BETTER_AUTH_SECRET:workerd-smoke-test-only-secret-0123456789abcdef',
      '--var',
      `APP_ORIGIN:${origin}`,
      // Without this, wrangler dev presents requests as coming to the production domain in the Worker's route.
      '--local-upstream',
      `127.0.0.1:${PORT}`,
      '--port',
      String(PORT),
      '--ip',
      '127.0.0.1',
    ],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  );
  let output = '';
  // Both pipes are drained while the Worker runs, so a full pipe never blocks it.
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) output += decoder.decode(chunk, { stream: true });
  };
  const collected = Promise.all([collect(worker.stdout), collect(worker.stderr)]);
  const failures: string[] = [];
  try {
    await waitForWorker(Date.now() + 90_000);
    for (const { path, init, status, contains } of CHECKS) {
      const response = await fetch(origin + path, {
        ...init,
        headers: { 'Content-Type': 'application/json', Origin: origin, ...(init?.headers as Record<string, string>) },
      });
      const body = await response.text();
      // Every response, including errors, asks browsers to use HTTPS only.
      const ok =
        response.status === status && (!contains || body.includes(contains)) && Boolean(response.headers.get('Strict-Transport-Security'));
      const label = `${init?.method ?? 'GET'} ${path}${init?.headers ? ' (' + Object.keys(init.headers).join(', ') + ')' : ''}`;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${response.status}`);
      if (!ok) failures.push(`${path}: HTTP ${response.status} ${body.slice(0, 200)}`);
    }
    const errors = output.split('\n').filter((line) => line.includes('"level":"error"'));
    if (errors.length) failures.push('The Worker logged errors:\n' + errors.join('\n'));
  } finally {
    worker.kill();
    await worker.exited;
    await collected;
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(`All ${CHECKS.length} routes answered as expected in workerd.`);
}
