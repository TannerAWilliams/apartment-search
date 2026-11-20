declare module 'cloudflare:workers' {
  export type WorkflowEvent<Payload> = { payload: Payload };
  export type WorkflowStep = {
    do<T>(name: string, config: { timeout?: string; retries?: { limit: number; delay: string } }, callback: () => Promise<T>): Promise<T>;
    sleep(name: string, duration: string): Promise<void>;
  };
  export abstract class WorkflowEntrypoint<Env, Payload> {
    protected env: Env;
    abstract run(event: WorkflowEvent<Payload>, step: WorkflowStep): Promise<unknown>;
  }
}
