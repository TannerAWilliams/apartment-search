import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('private Bun server rejects anonymous API, supports cookie login and rejects cross-origin writes', async () => {
 const secret = 'test-only-not-a-real-credential-1234567890';
 const port = 32000 + Math.floor(Math.random() * 10000);
 const origin = `http://127.0.0.1:${port}`;
 const child = spawn(process.execPath, ['--preload', './test/fixtures/offline-network.ts', 'server/main.ts'], { cwd: process.cwd(), env: { ...process.env,DATABASE_URL:'', HOST: '127.0.0.1', PORT: String(port), APP_ACCESS_TOKEN: secret, RENDER_EXTERNAL_URL: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
 try {
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Server failed to start'); }), new Promise((_, reject) => setTimeout(() => reject(new Error('startup timeout')), 10000).unref())]);
  assert.equal((await fetch(origin + '/api/config')).status, 401);
  assert.equal((await fetch(origin + '/api/dashboard')).status, 401);
  assert.match(await (await fetch(origin)).text(), /This app is private/);
  assert.equal((await fetch(origin + '/health')).status, 200);
  assert.equal((await fetch(origin + '/login', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: 'password=' + secret, redirect: 'manual' })).status, 403);
  const login = await fetch(origin + '/login', { method: 'POST', headers: { Origin: origin }, body: 'password=' + secret, redirect: 'manual' });
  assert.equal(login.status, 303); const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  const headers = { Cookie: cookie.split(';')[0] };
  assert.equal((await fetch(origin + '/api/config', { headers })).status, 200);
  assert.equal((await fetch(origin + '/api/search', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(origin + '/api/search', { method: 'POST', headers: { ...headers, Origin: origin, 'Content-Type': 'application/json' }, body: 'x'.repeat(5000) })).status, 413);
  const dashboard = await fetch(origin + '/api/dashboard', { headers });
  assert.equal(dashboard.status, 200); assert.equal((await dashboard.json()).files.length, 45);
  const page = await fetch(origin + '/', { headers });
  assert.equal(page.status, 200); assert.match(await page.text(), /<html/i);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  const head = await fetch(origin + '/', { method: 'HEAD', headers });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await fetch(origin + '/missing-file.txt', { headers })).status, 404);
  assert.equal((await fetch(origin + '/..%2Fpackage.json', { headers })).status, 404);
  assert.equal((await fetch(origin + '/', { method: 'DELETE', headers })).status, 405);
  const logout = await fetch(origin + '/logout', { method: 'POST', headers: { ...headers, Origin: origin }, redirect: 'manual' });
  assert.equal(logout.status, 303); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
 } finally { child.kill('SIGTERM'); await once(child, 'exit'); }
});
