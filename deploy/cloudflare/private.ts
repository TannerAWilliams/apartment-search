import apartment from '../../server/cloudflare.ts';
import { secretsEqual } from '../../server/private-session.ts';

export default {
  fetch(request: Request, env: Parameters<typeof apartment.fetch>[1]) {
    if (!env.APP_ACCESS_TOKEN || !secretsEqual(request.headers.get('Authorization') ?? '', 'Bearer ' + env.APP_ACCESS_TOKEN)) {
      return new Response('Private staging preview', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    return apartment.fetch(request, env);
  },
};
