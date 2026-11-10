const TRANSIENT = new Set([502, 503, 504]);
const MINUTE = 60_000;

class SourceResponseError extends Error {
  constructor(response, receivedAt) {
    super('HTTP ' + response.status);
    this.httpStatus = response.status;
    this.receivedAt = receivedAt;
    const retryAfter = response.headers.get('Retry-After')?.trim();
    const retryTime = /^\d{1,9}$/.test(retryAfter ?? '') ? receivedAt + Number(retryAfter) * 1000 : Date.parse(retryAfter);
    const reset = response.headers.get('X-RateLimit-Reset');
    const resetTime = response.headers.get('X-RateLimit-Remaining') === '0' && /^\d{1,12}$/.test(reset ?? '') ?
      Number(reset) * 1000 : 0;
    this.retryAfter = Math.max(retryTime || 0, resetTime || 0);
  }
}

export function requestForRefresh(fetcher, deadline) {
  return async (url, options) => {
    const headers = new Headers(options?.headers);
    headers.set('Cache-Control', 'no-cache');
    const signal = options?.signal && typeof AbortSignal.any === 'function' ?
      AbortSignal.any([options.signal, deadline]) : deadline;
    const init = { ...options, headers, signal };
    let response = await fetcher(url, init);
    const method = options?.method ?? 'GET';
    if ((method === 'GET' || method === 'HEAD') && TRANSIENT.has(response.status) && !signal.aborted &&
        !response.headers.has('Retry-After')) {
      await response.body?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!signal.aborted) response = await fetcher(url, init);
    }
    if (response.ok || response.status === 304) return response;

    const error = new SourceResponseError(response, Date.now());
    await response.body?.cancel().catch(() => {});
    throw error;
  };
}

export function retrySchedule(error, previous, startedAt) {
  const status = error?.httpStatus;
  if (![401, 403, 429].includes(status) && !error?.retryAfter) return {};

  const attempts = Math.min((previous?.retryAttempts ?? 0) + 1, 7);
  const base = status === 401 || status === 403 ? 15 * MINUTE : MINUTE;
  const backoff = Math.min(base * 2 ** (attempts - 1), 60 * MINUTE);
  const retryAt = Math.max(error.retryAfter, Math.max(error.receivedAt, startedAt) + backoff);
  return { retryAt: new Date(retryAt).toISOString(), retryAttempts: attempts };
}
