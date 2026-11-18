import apartment from './cloudflare.mjs';
import { timingSafeEqual } from 'node:crypto';

export default {
  fetch(request, env) {
    const encoder = new TextEncoder();
    const expected = encoder.encode('Bearer ' + (env.APP_ACCESS_TOKEN ?? ''));
    const actual = encoder.encode(request.headers.get('Authorization') ?? '');
    if (!env.APP_ACCESS_TOKEN || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return new Response('Private staging preview', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    return apartment.fetch(request, env);
  },
};
