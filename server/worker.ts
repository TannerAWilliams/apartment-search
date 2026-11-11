import assets from 'virtual:web-assets';
import { handleApi } from './api.ts';

function workerFetch(url, options) {
  // The Worker supports manual redirects. Source readers reject non-success responses.
  const init = options?.redirect === 'error' ? { ...options, redirect: 'manual' } : options;
  return globalThis.fetch(url, init);
}

export default {
  async fetch(request, env, context) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      return handleApi(request, env, { fetcher: workerFetch, waitUntil: context?.waitUntil?.bind(context) });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    const key = pathname === '/' ? '/index.html' : pathname;
    if (!Object.hasOwn(assets, key)) return new Response('Page not found.', { status: 404 });

    const asset = assets[key];
    const body = request.method === 'HEAD' ? null : asset.binary ?
      Uint8Array.from(atob(asset.content), (character) => character.charCodeAt(0)) : asset.content;
    return new Response(body, { headers: {
      'Content-Type': asset.type,
      'Cache-Control': key.startsWith('/_expo/static/') ? 'private, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    } });
  },
};
