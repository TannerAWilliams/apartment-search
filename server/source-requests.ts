import type { SourceFetch } from './refresh.ts';
import { STREETEASY_API_URL, STREETEASY_PUBLIC_SEARCH_URL } from './streeteasy.ts';

const TRANSIENT = new Set([502, 503, 504]);
const MINUTE = 60_000;
const ERROR_PREFIX_LIMIT = 16 * 1024;
const CLOUDFLARE_CHALLENGE = 'Cloudflare verification challenge';
const isChallenge = (response: Response) => response.headers.get('cf-mitigated') === 'challenge';

async function streetEasyDenial(response: Response): Promise<string | undefined> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remaining = ERROR_PREFIX_LIMIT;
  let prefix = '';
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      prefix += decoder.decode(value.subarray(0, remaining), { stream: true });
      remaining -= value.byteLength;
    }
  } catch {
    return;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (/px-captcha|perimeterx.*captcha|please verify (?:that )?you are (?:a )?human/i.test(prefix)) {
    return 'browser verification challenge';
  }
  if (/request blocked by (?:the )?egress|outbound network policy/i.test(prefix)) return 'outbound network policy';
  if (/<title[^>]*>\s*Access Denied\s*<\/title>/i.test(prefix)) return 'upstream access-denied page';
}


/** A source that answered with an error status; its fields say when to retry and why it refused. */
export class SourceResponseError extends Error {
  declare httpStatus: number;
  declare receivedAt: number;
  declare retryAfter: number;
  declare providerDenial?: string;
  constructor(response: Response, receivedAt: number) {
    super('HTTP ' + response.status);
    this.httpStatus = response.status;
    this.receivedAt = receivedAt;
    const retryAfter = response.headers.get('Retry-After')?.trim();
    const retryTime = /^\d{1,9}$/.test(retryAfter ?? '') ? receivedAt + Number(retryAfter) * 1000 : Date.parse(retryAfter ?? '');
    const reset = response.headers.get('X-RateLimit-Reset');
    const resetTime = response.headers.get('X-RateLimit-Remaining')?.trim() === '0' && /^\d{1,12}$/.test(reset ?? '') ?
      Number(reset) * 1000 : 0;
    this.retryAfter = Math.max(retryTime || 0, resetTime || 0);
  }
}

export function requestForRefresh(fetcher: SourceFetch, deadline: AbortSignal) {
  return async (url: string, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    headers.set('Cache-Control', 'no-cache');
    const signal = options?.signal && typeof AbortSignal.any === 'function' ?
      AbortSignal.any([options.signal, deadline]) : deadline;
    const init = { ...options, headers, signal };
    let response = await fetcher(url, init);
    const method = (options?.method ?? 'GET').toUpperCase();
    const exhausted = response.headers.get('X-RateLimit-Remaining')?.trim() === '0';
    if ((method === 'GET' || method === 'HEAD') && TRANSIENT.has(response.status) && !signal.aborted &&
        !response.headers.has('Retry-After') && !exhausted && !isChallenge(response)) {
      await response.body?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!signal.aborted) response = await fetcher(url, init);
    }
    const challenged = isChallenge(response);
    if (!challenged && (response.ok || response.status === 304)) return response;

    const error = new SourceResponseError(response, Date.now());
    if (challenged) error.providerDenial = CLOUDFLARE_CHALLENGE;
    else if (response.status === 403 && (url === STREETEASY_API_URL || url === STREETEASY_PUBLIC_SEARCH_URL)) {
      error.providerDenial = await streetEasyDenial(response);
    }
    await response.body?.cancel().catch(() => {});
    throw error;
  };
}

export function retrySchedule(error: { httpStatus?: number; retryAfter?: unknown; receivedAt?: unknown; providerDenial?: string } | null | undefined, previous: { retryAttempts?: number } | undefined, startedAt: number) {
  const status = error?.httpStatus;
  const refused = status === 401 || status === 403 || error?.providerDenial === CLOUDFLARE_CHALLENGE;
  if (!refused && status !== 429 && !error?.retryAfter) return {};

  const attempts = Math.min((previous?.retryAttempts ?? 0) + 1, 7);
  const base = refused ? 15 * MINUTE : MINUTE;
  const backoff = Math.min(base * 2 ** (attempts - 1), 60 * MINUTE);
  const receivedAt = typeof error?.receivedAt === 'number' && Number.isFinite(error.receivedAt) ? error.receivedAt : startedAt;
  const serverRetryAt = typeof error?.retryAfter === 'number' && Number.isFinite(error.retryAfter) ? error.retryAfter : 0;
  const retryAt = Math.max(serverRetryAt, Math.max(receivedAt, startedAt) + backoff);
  return { retryAt: new Date(retryAt).toISOString(), retryAttempts: attempts };
}
