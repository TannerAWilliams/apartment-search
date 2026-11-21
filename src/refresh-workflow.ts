export type RefreshWorkflow = {
  id: string;
  sources: string[];
  status: 'starting' | 'queued' | 'running' | 'waiting' | 'paused' | 'unknown' | 'complete' | 'errored' | 'terminated';
  startedAt: string;
  canRetryStart?: boolean;
};

export function workflowPending(workflow?: RefreshWorkflow): boolean {
  return Boolean(workflow && !['complete', 'errored', 'terminated'].includes(workflow.status));
}
