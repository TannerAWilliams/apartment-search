import { CITYREALTY_COVERAGE, CITYREALTY_ID, CITYREALTY_TRANSPORT } from './cityrealty.ts';
import { OPENIGLOO, OPENIGLOO_COVERAGE, OPENIGLOO_TRANSPORT } from './openigloo.ts';
import { ZUMPER_COVERAGE, ZUMPER_LIVE, ZUMPER_TRANSPORT } from './zumper.ts';

/**
 * Sources that sync their whole inventory rather than a sample. Their syncs are too long for an
 * API request, so on Cloudflare they run in the sync Workflow, and their data counts as current
 * for a day. Add a source here, not as special cases in refresh or the API.
 */
export type CompleteSync = {
  id: string;
  name: string;
  /** The transport a complete snapshot records; any other transport is a sample. */
  transport: string;
  coverage: string;
  /** Upper bound for one sync, which also bounds the refresh lock it holds. */
  timeoutMs: number;
  /** Timeout of the Workflow step that runs the sync (Openigloo runs in several steps). */
  stepTimeout: '13 minutes' | '25 minutes' | '30 minutes';
};

export const COMPLETE_SYNCS: readonly CompleteSync[] = [
  { id: CITYREALTY_ID, name: 'CityRealty', transport: CITYREALTY_TRANSPORT, coverage: CITYREALTY_COVERAGE,
    timeoutMs: 12 * 60_000, stepTimeout: '13 minutes' },
  { id: OPENIGLOO.id, name: OPENIGLOO.name, transport: OPENIGLOO_TRANSPORT, coverage: OPENIGLOO_COVERAGE,
    timeoutMs: 28 * 60_000, stepTimeout: '30 minutes' },
  { id: ZUMPER_LIVE.id, name: ZUMPER_LIVE.name, transport: ZUMPER_TRANSPORT, coverage: ZUMPER_COVERAGE,
    timeoutMs: 25 * 60_000, stepTimeout: '25 minutes' },
];

export const WORKFLOW_SOURCE_IDS = COMPLETE_SYNCS.map(({ id }) => id);
export const COMPLETE_SYNC_LIFETIME = 24 * 60 * 60_000;

export const completeSync = (id: string | null | undefined) => COMPLETE_SYNCS.find((source) => source.id === id);

/** Whether a saved snapshot is the source's complete inventory rather than a sample. */
export const isCompleteSnapshot = (id: string, transport: string | undefined) =>
  transport !== undefined && completeSync(id)?.transport === transport;

/** Whether catalog coverage text describes a complete sync. */
export const isCompleteCoverage = (coverage: string | undefined) =>
  COMPLETE_SYNCS.some((source) => source.coverage === coverage);
