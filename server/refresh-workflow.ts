import type { Bucket } from './contracts.ts';

const JOB_KEY = 'rentals/complete-refresh-workflow.json';
const CREATE_RETRY_MS = 30_000;

export type WorkflowStatus = 'starting' | 'queued' | 'running' | 'waiting' | 'paused' | 'unknown' | 'complete' | 'errored' | 'terminated';
export type RefreshWorkflowJob = { id: string; sources: string[]; status: WorkflowStatus; startedAt: string; canRetryStart?: true };
export type RefreshWorkflowBinding = {
  create(options: { id: string; params: { delay: boolean; sources: string[] } }): Promise<unknown>;
  get(id: string): Promise<{ status(): Promise<{ status: string }> }>;
};
export type RefreshWorkflow = {
  start(delay: boolean, sources?: string[]): Promise<RefreshWorkflowJob>;
  status(): Promise<RefreshWorkflowJob | null>;
  retry(id: string): Promise<RefreshWorkflowJob | null>;
};

type Record = Omit<RefreshWorkflowJob, 'canRetryStart'> & { delay: boolean; lastCreateAttemptAt: number };
type Stored = { record: Record; etag: string };
const terminal = (status: WorkflowStatus) => status === 'complete' || status === 'errored' || status === 'terminated';
export const isRefreshWorkflowId = (id: unknown): id is string =>
  typeof id === 'string' && /^rental-refresh-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const knownStatuses = new Set(['starting', 'queued', 'running', 'waiting', 'paused', 'complete', 'errored', 'terminated']);

function normalizeStatus(value: string): WorkflowStatus {
  switch (value) {
    case 'queued': case 'running': case 'waiting': case 'paused':
    case 'complete': case 'errored': case 'terminated': return value;
    case 'waitingForPause': case 'rollingBack': return 'running';
    default: return 'unknown';
  }
}

function publicJob({ id, sources, status, startedAt }: Record, observed = status): RefreshWorkflowJob {
  return { id, sources, status: observed, startedAt };
}

function durableRegistry(bucket: Bucket, allowedSources: readonly string[]) {
  async function read(): Promise<Stored | null> {
    const object = await bucket.get(JOB_KEY);
    if (!object) return null;
    const record: Record | null = await object.json();
    if (!record || !isRefreshWorkflowId(record.id) ||
      !Array.isArray(record.sources) || record.sources.length === 0 || record.sources.some(id => !allowedSources.includes(id)) ||
      new Set(record.sources).size !== record.sources.length || typeof record.startedAt !== 'string' || !Number.isFinite(Date.parse(record.startedAt)) ||
      typeof record.delay !== 'boolean' || !Number.isFinite(record.lastCreateAttemptAt) || !knownStatuses.has(record.status)) {
      // Unreadable tracking state cannot safely be replaced by a new possibly overlapping job.
      throw new Error('The complete refresh tracking record could not be read.');
    }
    return { record, etag: object.etag };
  }

  async function save(record: Record, prior: Stored | null): Promise<Stored | null> {
    const written = await bucket.put(JOB_KEY, JSON.stringify(record), {
      onlyIf: prior ? { etagMatches: prior.etag } : { etagDoesNotMatch: '*' },
    });
    return written ? { record, etag: written.etag } : null;
  }

  return { read, save };
}

/** Save even when no browser is polling; never update a different or already terminal job. */
export async function recordRefreshWorkflowOutcome(bucket: Bucket, allowedSources: readonly string[],
  id: string, status: 'complete' | 'errored'): Promise<void> {
  const { read, save } = durableRegistry(bucket, allowedSources);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await read();
    if (!current || current.record.id !== id || terminal(current.record.status)) return;
    if (await save({ ...current.record, status }, current)) return;
  }
  throw new Error('The complete refresh tracking record is busy.');
}

/**
 * Reserve one complete-refresh job in durable storage before asking Cloudflare to create it.
 * Neither wall-clock buckets nor the inventory publication lease identify a Workflow instance.
 */
export function createRefreshWorkflow(bucket: Bucket, binding: RefreshWorkflowBinding, allowedSources: readonly string[],
  now = Date.now): RefreshWorkflow {
  const { read, save } = durableRegistry(bucket, allowedSources);

  async function observe(id: string): Promise<WorkflowStatus> {
    try { return normalizeStatus((await (await binding.get(id)).status()).status); }
    catch { return 'unknown'; }
  }

  function unconfirmed(record: Record): RefreshWorkflowJob {
    return now() - record.lastCreateAttemptAt >= CREATE_RETRY_MS ?
      { ...publicJob(record, 'unknown'), canRetryStart: true } : publicJob(record, 'starting');
  }

  async function dispatch(claim: Stored): Promise<RefreshWorkflowJob> {
    const { record } = claim;
    let status: WorkflowStatus;
    try {
      await binding.create({ id: record.id, params: { delay: record.delay, sources: record.sources } });
      status = 'queued';
    } catch {
      // A lost create response is ambiguous. Inspect this same ID; never launch a replacement.
      status = await observe(record.id);
    }
    if (status !== 'unknown' && !await save({ ...record, status }, claim)) {
      const current = await read();
      if (current?.record.id === record.id && terminal(current.record.status)) return publicJob(current.record);
    }
    return publicJob(record, status);
  }

  return {
    async status() {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await read();
        if (!current || terminal(current.record.status)) return current ? publicJob(current.record) : null;
        const observed = await observe(current.record.id);
        // Store a known instance and its terminal result. An unavailable status service is not a completion.
        if (observed !== 'unknown' && (current.record.status === 'starting' || terminal(observed))) {
          if (!await save({ ...current.record, status: observed }, current)) continue;
        }
        return observed === 'unknown' && current.record.status === 'starting' ?
          unconfirmed(current.record) : publicJob(current.record, observed);
      }
      throw new Error('The complete refresh tracking record is busy.');
    },

    async retry(id) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await read();
        if (!current || current.record.id !== id) return null;
        if (current.record.status !== 'starting') return publicJob(current.record);
        const observed = await observe(id);
        if (observed !== 'unknown') {
          if (await save({ ...current.record, status: observed }, current)) return publicJob(current.record, observed);
          continue;
        }
        if (!unconfirmed(current.record).canRetryStart) return publicJob(current.record, 'starting');
        // Reserve a retry of the same Cloudflare creation, not another provider refresh.
        const claim = await save({ ...current.record, lastCreateAttemptAt: now() }, current);
        if (claim) return dispatch(claim);
      }
      throw new Error('The complete refresh tracking record is busy.');
    },

    async start(delay, requested = [...allowedSources]) {
      if (!requested.length || requested.some(id => !allowedSources.includes(id))) throw new Error('Unknown complete refresh source.');
      for (let attempt = 0; attempt < 5; attempt++) {
        const prior = await read();
        if (prior && !terminal(prior.record.status)) {
          const observed = await observe(prior.record.id);
          if (observed !== 'unknown' && (prior.record.status === 'starting' || terminal(observed))) {
            if (!await save({ ...prior.record, status: observed }, prior)) continue;
            if (!terminal(observed)) return publicJob(prior.record, observed);
            // The click encountered a tracked instance. Report its terminal outcome; another explicit click may start a new job.
            return publicJob(prior.record, observed);
          }
          return observed === 'unknown' && prior.record.status === 'starting' ?
            unconfirmed(prior.record) : publicJob(prior.record, observed);
        }
        const time = now();
        const claimed = await save({ id: 'rental-refresh-' + crypto.randomUUID(), sources: [...new Set(requested)],
          status: 'starting', startedAt: new Date(time).toISOString(), delay, lastCreateAttemptAt: time }, prior);
        if (claimed) return dispatch(claimed);
      }
      throw new Error('The complete refresh tracking record is busy.');
    },
  };
}
