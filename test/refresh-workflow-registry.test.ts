import { expect, test } from 'bun:test';
import type { Bucket } from '../server/contracts.ts';
import { createRefreshWorkflow, recordRefreshWorkflowOutcome, type RefreshWorkflowBinding } from '../server/refresh-workflow.ts';

const allowed = ['cityrealty', 'openigloo', 'zumper-live'];

function fixture() {
  const stored = new Map<string, { body: string; etag: string }>();
  let version = 0;
  let time = Date.parse('2026-11-21T12:00:00.000Z');
  const bucket: Bucket = {
    async head(key) {
      const row = stored.get(key);
      return row ? { etag: row.etag, customMetadata: {} } : null;
    },
    async get(key) {
      const row = stored.get(key);
      return row ? { etag: row.etag, customMetadata: {},
        text: async () => row.body, json: async () => JSON.parse(row.body),
        arrayBuffer: async () => new TextEncoder().encode(row.body).buffer } : null;
    },
    async put(key, body, options) {
      const prior = stored.get(key);
      if (options?.onlyIf?.etagDoesNotMatch === '*' && prior ||
        options?.onlyIf?.etagMatches !== undefined && options.onlyIf.etagMatches !== prior?.etag) return null;
      const etag = String(++version);
      stored.set(key, { etag, body: String(body) });
      return { etag };
    },
  };
  const creates: Parameters<RefreshWorkflowBinding['create']>[0][] = [];
  const gets: string[] = [];
  let currentStatus = 'queued';
  let createFailure = false;
  let statusFailure = false;
  let beforeCreate: (() => Promise<void>) | undefined;
  const existing = new Set<string>();
  const binding: RefreshWorkflowBinding = {
    async create(request) {
      creates.push(request);
      await beforeCreate?.();
      if (createFailure) throw new Error('Private upstream create error');
      if (existing.has(request.id)) throw new Error('Duplicate ID (instance.already_exists)');
      existing.add(request.id);
    },
    async get(id) {
      gets.push(id);
      if (statusFailure || !existing.has(id)) throw new Error('Private upstream status error');
      return { status: async () => ({ status: currentStatus }) };
    },
  };
  return { stored, bucket, creates, gets, manager: () => createRefreshWorkflow(bucket, binding, allowed, () => time),
    advance: (ms: number) => { time += ms; }, status: (value: string) => { currentStatus = value; },
    createFailure: (value: boolean) => { createFailure = value; }, statusFailure: (value: boolean) => { statusFailure = value; },
    beforeCreate: (hook: () => Promise<void>) => { beforeCreate = hook; },
    seedExisting: (id: string) => { existing.add(id); } };
}

test('reload after 47 minutes tracks the exact Openigloo ID and does not create a replacement', async () => {
  const f = fixture();
  const started = await f.manager().start(false, ['openigloo']);
  expect(started).toMatchObject({ status: 'queued', sources: ['openigloo'], startedAt: '2026-11-21T12:00:00.000Z' });
  f.advance(47 * 60_000);
  f.status('waiting');
  expect(await f.manager().status()).toEqual({ ...started, status: 'waiting' });
  expect(await f.manager().start(true)).toEqual({ ...started, status: 'waiting' });
  expect(f.gets).toEqual([started.id, started.id]);
  expect(f.creates).toHaveLength(1);
});

test('concurrent requests reserve once and report actual job scope during creation', async () => {
  const f = fixture();
  const jobs = await Promise.all([
    f.manager().start(false, ['openigloo']),
    f.manager().start(true),
    f.manager().start(false, ['cityrealty']),
  ]);
  expect(f.creates).toHaveLength(1);
  expect(new Set(jobs.map(job => job.id))).toHaveProperty('size', 1);
  expect(jobs.every(job => job.sources.join() === f.creates[0].params.sources.join())).toBe(true);
});

test('a create acknowledgement failure stays trackable and retry preserves ID and request parameters', async () => {
  const f = fixture();
  f.createFailure(true);
  const failed = await f.manager().start(false, ['openigloo']);
  expect(failed.status).toBe('unknown');
  expect((await f.manager().status())?.status).toBe('starting');
  f.advance(60_000);
  expect(await f.manager().status()).toMatchObject({ status: 'unknown', canRetryStart: true });
  expect(f.creates).toHaveLength(1); // GET must not create anything.
  expect(await f.manager().start(true, ['cityrealty'])).toMatchObject({ id: failed.id, canRetryStart: true });
  expect(await f.manager().retry('another-id')).toBeNull();
  f.createFailure(false);
  const recovered = await f.manager().retry(failed.id);
  expect(recovered).toEqual({ ...failed, status: 'queued' });
  expect(f.creates[1]).toEqual(f.creates[0]);
  expect(await f.manager().retry(failed.id)).toEqual(recovered);
  expect(f.creates).toHaveLength(2);
});

test('queued and paused jobs with unavailable status are not false completions or duplicates', async () => {
  const f = fixture();
  const started = await f.manager().start(false, ['openigloo']);
  f.status('paused');
  expect(await f.manager().status()).toEqual({ ...started, status: 'paused' });
  f.statusFailure(true);
  f.advance(24 * 60 * 60_000);
  expect(await f.manager().status()).toEqual({ ...started, status: 'unknown' });
  expect(await f.manager().start(false, ['openigloo'])).toEqual({ ...started, status: 'unknown' });
  expect(f.creates).toHaveLength(1);
});

for (const status of ['complete', 'errored', 'terminated'] as const) {
  test(`terminal ${status} persists even if Cloudflare later stops serving that instance`, async () => {
    const f = fixture();
    const started = await f.manager().start(false, ['openigloo']);
    f.status(status);
    expect(await f.manager().status()).toEqual({ ...started, status });
    f.statusFailure(true);
    expect(await f.manager().status()).toEqual({ ...started, status });
    const next = await f.manager().start(false, ['zumper-live']);
    expect(next.id).not.toBe(started.id);
    expect(next.sources).toEqual(['zumper-live']);
    expect(f.creates).toHaveLength(2);
  });
}

test('workflow receipt persists without a poll and never updates a newer job', async () => {
  const f = fixture();
  const started = await f.manager().start(false, ['openigloo']);
  await recordRefreshWorkflowOutcome(f.bucket, allowed, started.id, 'complete');
  f.statusFailure(true);
  expect(await f.manager().status()).toEqual({ ...started, status: 'complete' });
  const next = await f.manager().start(false, ['zumper-live']);
  await recordRefreshWorkflowOutcome(f.bucket, allowed, started.id, 'errored');
  f.statusFailure(false);
  expect(await f.manager().status()).toEqual(next);
});

test('a completion receipt winning the create race is not overwritten or reported as queued', async () => {
  const f = fixture();
  f.beforeCreate(async () => {
    await recordRefreshWorkflowOutcome(f.bucket, allowed, f.creates[0].id, 'complete');
  });
  const result = await f.manager().start(false, ['openigloo']);
  expect(result.status).toBe('complete');
  expect(await f.manager().status()).toEqual(result);
});

test('documented duplicate acknowledgement confirms existence without fabricating observable status', async () => {
  const f = fixture();
  f.createFailure(true);
  const pending = await f.manager().start(false, ['openigloo']);
  f.seedExisting(pending.id);
  f.statusFailure(true);
  f.createFailure(false);
  f.advance(31_000);
  expect(await f.manager().status()).toMatchObject({ id: pending.id, canRetryStart: true });
  expect(await f.manager().retry(pending.id)).toEqual({ ...pending, status: 'unknown' });
  f.advance(4 * 24 * 60 * 60_000);
  expect(await f.manager().status()).toEqual({ ...pending, status: 'unknown' });
  expect(await f.manager().start(false, ['zumper-live'])).toEqual({ ...pending, status: 'unknown' });
  await f.manager().retry(pending.id);
  expect(f.creates).toHaveLength(2);
});
