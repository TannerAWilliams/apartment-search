// Loaded before the tests (bunfig.toml). Cloudflare's runtime module exists only in workerd, so every test gets
// the same stand-in for the one class the Worker uses: a WorkflowEntrypoint that keeps the env it was given.
import { mock } from 'bun:test';

mock.module('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {
    env: unknown;
    constructor(_ctx: unknown, env: unknown) {
      this.env = env;
    }
  },
}));
