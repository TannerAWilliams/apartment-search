import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateShortlistHandler } from '../server/private-shortlist.ts';
import { createMemoryBucket } from '../server/memory-bucket.ts';
const entry = (key = 'unit:1') => ({ key, label: 'Test apartment', url: 'https://example.com/rental/1', rent: 2000, bedrooms: 1, notes: 'Private note', status: 'Considering', compare: false });
const identities = { alice: { issuer: 'https://issuer.example', subject: 'alice' }, bob: { issuer: 'https://issuer.example', subject: 'bob' }, otherIssuer: { issuer: 'https://other.example', subject: 'alice' } };
const setup = () => createPrivateShortlistHandler({ bucket: createMemoryBucket(), verifyBearer: async token => identities[token] ?? null });
const request = (token = 'alice', payload?: unknown, method = payload === undefined ? 'GET' : 'PUT') => new Request('https://app.example/private/shortlist?subject=bob', {
  method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
});
test('private sync defaults disabled and never falls back to public/app-wide sessions', async () => {
  assert.equal((await createPrivateShortlistHandler()(request())).status, 503);
  const handler = setup();
  assert.equal((await handler(new Request('https://app.example', { headers: { Cookie: 'apartment-session=anything', 'X-User-ID': 'alice' } }))).status, 401);
  assert.equal((await handler(request('unknown'))).status, 401);
  assert.equal((await handler(request('alice', undefined, 'DELETE'))).status, 405);
  assert.equal((await createPrivateShortlistHandler({ bucket: createMemoryBucket(), verifyBearer: async () => { throw new Error('secret'); } })(request())).status, 401);
  for (const identity of [null, {}, { issuer: '', subject: 'alice' }, { issuer: 'x', subject: '' }, { issuer: 'x'.repeat(2049), subject: 'a' }, { issuer: 'x', subject: 'a'.repeat(513) }]) {
    assert.equal((await createPrivateShortlistHandler({ bucket: createMemoryBucket(), verifyBearer: async () => identity as any })(request())).status, 401);
  }
});
test('verified issuer/subject isolates users regardless of caller IDs; two devices detect conflicts', async () => {
  const handler = setup();
  const initial = await handler(request());
  assert.equal(initial.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(initial.headers.get('Vary'), 'Authorization');
  assert.deepEqual(await initial.json(), { revision: null, entries: [] });
  const created = await handler(request('alice', { revision: null, subject: 'bob', issuer: 'forged', entries: [{ ...entry(), owner: 'bob' }] }));
  const saved = await created.json();
  assert.equal(created.status, 200); assert.ok(saved.revision); assert.equal('owner' in saved.entries[0], false);
  for (const token of ['bob', 'otherIssuer']) assert.deepEqual((await (await handler(request(token))).json()).entries, []);
  assert.deepEqual((await (await handler(request())).json()).entries, [entry()]);
  assert.equal((await handler(request('alice', { revision: null, entries: [] }))).status, 409);
  const updated = await handler(request('alice', { revision: saved.revision, entries: [{ ...entry(), notes: 'New note', compare: true }] }));
  assert.equal(updated.status, 200);
  assert.equal((await handler(request('alice', { revision: saved.revision, entries: [] }))).status, 409);
  assert.equal((await (await handler(request())).json()).entries[0].notes, 'New note');
});
test('payload limits, schema and unsafe URLs reject without replacing existing private data', async () => {
  const handler = setup();
  const { revision } = await (await handler(request('alice', { revision: null, entries: [entry()] }))).json();
  const invalidEntries = [null, {}, Array(101).fill(entry()), [entry(), entry()], ...[
    { key: '' }, { key: 'x'.repeat(501) }, { label: ' ' }, { label: 'x'.repeat(301) }, { notes: 'x'.repeat(2001) }, { notes: 1 },
    { status: 'Other' }, { compare: 'true' }, { rent: -1 }, { rent: '2000' }, { bedrooms: 1.5 }, { bedrooms: 21 },
    { url: 'javascript:alert(1)' }, { url: 'https://example.com/' + 'x'.repeat(2048) },
  ].map(patch => [{ ...entry(), ...patch }])];
  for (const entries of invalidEntries) assert.equal((await handler(request('alice', { revision, entries }))).status, 400);
  for (const payload of [null, {}, { entries: [] }, { revision: 1, entries: [] }, { revision: '', entries: [] }]) assert.equal((await handler(request('alice', payload))).status, 400);
  assert.equal((await handler(new Request('https://app.example', { method: 'PUT', headers: { Authorization: 'Bearer alice' }, body: '{}' }))).status, 400);
  assert.equal((await handler(new Request('https://app.example', { method: 'PUT', headers: { Authorization: 'Bearer alice', 'Content-Type': 'application/json' }, body: 'x'.repeat(262145) }))).status, 400);
  assert.deepEqual((await (await handler(request())).json()).entries, [entry()]);
  assert.equal((await handler(request('alice', { revision, entries: [{ ...entry(), url: null, rent: null, bedrooms: null }] }))).status, 200);
});
test('storage errors and corrupt stored records fail closed without exposing details', async () => {
  const verifyBearer = async () => identities.alice;
  for (const stored of [{ version: 2, entries: [] }, { version: 1, entries: [{}] }]) {
    const handler = createPrivateShortlistHandler({ verifyBearer, bucket: { get: async () => ({ json: async () => stored }), put: async () => assert.fail('No write') } });
    assert.equal((await handler(request())).status, 503);
  }
  const handler = createPrivateShortlistHandler({ verifyBearer, bucket: { get: async () => { throw new Error('secret db password'); }, put: async () => { throw new Error('secret db password'); } } });
  for (const req of [request(), request('alice', { revision: null, entries: [] })]) {
    const result = await handler(req); assert.equal(result.status, 503); assert.equal((await result.text()).includes('secret'), false);
  }
});
