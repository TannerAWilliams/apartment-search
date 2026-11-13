import { timingSafeEqual } from 'node:crypto';
/** One explicit provider-free qualification per process, never startup/health. */
export function qualificationGate(token: string, qualify: () => Promise<boolean>, handler: (request: Request) => Promise<Response>) {
  let state: 'unqualified'|'running'|'passed'|'failed' = 'unqualified';
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === '/health') return new Response(JSON.stringify({ok:true,browserExecution:'hosted',providerTransport:'node',qualification:state}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    const actual = Buffer.from(request.headers.get('Authorization') || '');
    const expected = Buffer.from('Bearer '+token);
    if (!token || actual.length !== expected.length || !timingSafeEqual(actual,expected)) return new Response('Unauthorized',{status:401});
    if (path === '/browser/qualify' && request.method === 'POST') {
      if (state !== 'unqualified') return new Response('Qualification already attempted',{status:409});
      state='running';
      try { state=await qualify() ? 'passed' : 'failed'; } catch { state='failed'; }
      return new Response(JSON.stringify({qualification:state}),{status:state==='passed'?200:502,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    if (state !== 'passed') return new Response('Hosted browser not qualified',{status:503});
    return handler(request);
  };
}
