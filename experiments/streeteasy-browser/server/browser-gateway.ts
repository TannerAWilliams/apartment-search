import { timingSafeEqual } from 'node:crypto';
import { BrowserSession, isBrowserAction } from './browser-session.ts';

/** Experimental server-to-server surface. Never send the relay credential to web clients. */
export function browserGateway(token: string, session: BrowserSession) {
  if (token.length < 32) throw new Error('Browser relay token must have at least 32 characters');
  const expected = Buffer.from(`Bearer ${token}`);
  let windowStart = Date.now(); let count = 0;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return reply({ ok: true });
    const auth = Buffer.from(request.headers.get('Authorization') || '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return reply({ error: 'Unauthorized' }, 401);
    // No cookie auth or CORS: cross-site browsers cannot operate this interface.
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); count = 0; }
    if (++count > 120) return reply({ error: 'Browser operation limit reached' }, 429);
    try {
      if (path === '/browser/status' && request.method === 'GET') return reply({ state: session.state, complete: false });
      if (path === '/browser/screenshot' && request.method === 'GET') {
        const bytes = await session.screenshot();
        if (bytes.byteLength > 1024 * 1024) return reply({ error: 'Screenshot exceeds limit' }, 502);
        return new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (request.method !== 'POST') return reply({ error: 'Not found' }, 404);
      if (!['/fetch', '/browser/action', '/browser/resume', '/browser/close'].includes(path)) return reply({ error: 'Not found' }, 404);
      const reader = request.body?.getReader(); let length = 0; let text = ''; const decoder = new TextDecoder();
      if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 2048) { await reader.cancel(); return reply({ error: 'Request too large' }, 413); } text += decoder.decode(value, { stream: true }); }
      text += decoder.decode();
      if (path === '/fetch') {
        const response = await session.request(JSON.parse(text), request.signal);
        response.headers.set('Cache-Control', 'no-store'); response.headers.set('X-Content-Type-Options', 'nosniff'); return response;
      }
      if (path === '/browser/action') { const action: unknown = JSON.parse(text); if (!isBrowserAction(action)) return reply({ error: 'Invalid action' }, 422); await session.act(action); }
      if (path === '/browser/resume') await session.resume();
      if (path === '/browser/close') await session.close();
      return reply({ state: session.state, complete: false });
    } catch { return reply({ error: 'Browser operation unavailable', state: session.state }, 409); }
  };
}
