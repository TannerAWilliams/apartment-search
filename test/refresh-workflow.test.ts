import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowPending } from '../src/refresh-workflow.ts';
test('durable refresh states distinguish pending, failed and finished', () => {
  for (const status of ['starting', 'queued', 'running', 'waiting', 'paused', 'unknown'] as const) {
    assert.equal(workflowPending({ id: 'run', sources: ['openigloo'], status, startedAt: '2026-11-21T00:00:00Z' }), true);
  }
  for (const status of ['complete', 'errored', 'terminated'] as const) {
    assert.equal(workflowPending({ id: 'run', sources: [], status, startedAt: '' }), false);
  }
  assert.equal(workflowPending(), false);
});
