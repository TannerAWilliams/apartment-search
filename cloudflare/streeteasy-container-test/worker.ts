// One-off test: can a Cloudflare container fetch StreetEasy's inventory?
// POST /run starts the container once; GET /status shows the recorded result.
// Both require `Authorization: Bearer <TEST_TOKEN>`. A second run is refused,
// so a 403 is recorded once and never retried.
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import probe from './probe.generated.ts';

type Env = { TEST_TOKEN: string; PROBE: DurableObjectNamespace<StreetEasyProbe> };
type Result = Record<string, unknown>;

export class ReportSink extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const text = await request.text();
    if (text.length > 4096) return new Response(null, { status: 413 });
    const result: unknown = JSON.parse(text);
    if (typeof result !== 'object' || result === null || Array.isArray(result)) return new Response(null, { status: 400 });
    await this.env.PROBE.getByName('test').record({ ...result });
    return new Response('recorded');
  }
}

export class StreetEasyProbe extends DurableObject<Env> {
  async start() {
    if (await this.ctx.storage.get('startedAt')) return { state: 'already_run', ...(await this.status()) };
    const container = this.ctx.container!;
    await container.interceptOutboundHttp('report.internal', this.ctx.exports.ReportSink);
    container.start({ entrypoint: ['bun', '-e', probe], enableInternet: true });
    await this.ctx.storage.put('startedAt', new Date().toISOString());
    this.ctx.waitUntil(container.monitor().then(
      () => this.ctx.storage.put('exit', { code: 0 }),
      (error: { exitCode?: number }) => this.ctx.storage.put('exit', { code: error?.exitCode ?? null, error: String(error) }),
    ));
    return { state: 'started' };
  }

  async record(result: Result) {
    await this.ctx.storage.put('result', result);
  }

  async status() {
    const [startedAt, result, exit] = await Promise.all(['startedAt', 'result', 'exit'].map((key) => this.ctx.storage.get(key)));
    return { startedAt: startedAt ?? null, result: result ?? null, exit: exit ?? null };
  }
}

function authorized(request: Request, env: Env) {
  const expected = new TextEncoder().encode('Bearer ' + env.TEST_TOKEN);
  const actual = new TextEncoder().encode(request.headers.get('Authorization') ?? '');
  return env.TEST_TOKEN?.length >= 32 && actual.byteLength === expected.byteLength &&
    crypto.subtle.timingSafeEqual(actual, expected);
}

export default {
  async fetch(request: Request, env: Env) {
    if (!authorized(request, env)) return new Response('Unauthorized', { status: 401 });
    const { pathname } = new URL(request.url);
    const probeObject = env.PROBE.getByName('test');
    if (pathname === '/run' && request.method === 'POST') return Response.json(await probeObject.start());
    if (pathname === '/status' && request.method === 'GET') return Response.json(await probeObject.status());
    return new Response('Not found', { status: 404 });
  },
};
