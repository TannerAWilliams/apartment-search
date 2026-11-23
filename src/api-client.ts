import { isRecord, type SearchResult } from './domain.ts';
import type { FetchTransport } from './fetch-type.ts';
import type { SourceDefinition, SourceStatus } from './source-status.ts';

export type RefreshInfo = {
  sources: (SourceStatus & { month?: string; transport?: string })[];
  checking?: boolean;
  activeSource?: string | null;
  state?: string;
  lastCheckedAt?: string | null;
  refreshRetryAt?: number;
  market?: { revision?: string; catalogEtag?: string; csvEtag?: string } | null;
};
export type ConfigSource = { id: string; name: string; sample?: boolean };
export type ApiConfig = {
  sources: ConfigSource[];
  sourceCatalog?: SourceDefinition[];
  commuteConfigured?: boolean;
  companies?: Record<string, number>;
  refresh?: RefreshInfo;
  refreshRetryAt?: number;
  browserImportAllowed?: boolean;
  dashboardAvailable?: boolean;
  storageMode?: string;
};
type ApiOptions = { body?: object; token?: string; signal?: AbortSignal };
type ApiError = Error & { refreshRetryAt: number; status: number; commuteError: boolean };

const UNREACHABLE = 'Could not reach the apartment search server.';

function apiError(message: string, status: number, refreshRetryAt = 0, commuteError = false): ApiError {
  return Object.assign(new Error(message), { refreshRetryAt, status, commuteError });
}

/** A source status the app can render; anything else is reported as an error, not rendered. */
function isRefreshInfo(value: unknown): value is RefreshInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as RefreshInfo).sources) &&
    (value as RefreshInfo).sources.every((source) => typeof source?.id === 'string' && typeof source.status === 'string')
  );
}

/** A search result the app can render: its matches, count and the workplace they were measured from. */
function isSearchResult(value: unknown): value is SearchResult {
  const result = value as SearchResult;
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(result.matches) &&
    Number.isFinite(result.total) &&
    Number.isFinite(result.workplace?.latitude) &&
    Number.isFinite(result.workplace?.longitude)
  );
}

/**
 * Calls the app's API. Responses that are not JSON (such as a host's HTML error page) and
 * source statuses the app cannot render become ordinary errors instead of crashing the UI.
 */
export function createApi(origin: string | null, fetcher: FetchTransport = (input, init) => fetch(input, init)) {
  function api(path: 'config', options?: ApiOptions): Promise<ApiConfig>;
  function api(path: 'refresh', options?: ApiOptions): Promise<RefreshInfo>;
  function api(path: 'search', options?: ApiOptions): Promise<SearchResult>;
  function api<T = unknown>(path: string, options?: ApiOptions): Promise<T>;
  async function api<T>(path: string, { body, token, signal }: ApiOptions = {}): Promise<T> {
    if (origin === null) throw apiError(UNREACHABLE, 0);
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetcher(`${origin}/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      signal,
      body: body ? JSON.stringify(body) : undefined,
    });
    const wait = Number(
      response.headers.get('X-Refresh-Retry-After') ?? (response.status === 429 ? response.headers.get('Retry-After') : 0),
    );
    const refreshRetryAt = Number.isFinite(wait) && wait > 0 ? Date.now() + wait * 1000 : 0;
    let data: Record<string, unknown>;
    try {
      const parsed = await response.json();
      if (!isRecord(parsed)) throw new Error('Not an object');
      data = parsed;
    } catch {
      throw apiError(
        response.ok ? 'The apartment search server returned an unreadable response.' : UNREACHABLE,
        response.status,
        refreshRetryAt,
      );
    }
    if (!response.ok) {
      throw apiError(
        typeof data.error === 'string' && data.error ? data.error : UNREACHABLE,
        response.status,
        refreshRetryAt,
        data.commuteError === true,
      );
    }
    if (path === 'refresh' && !isRefreshInfo(data)) {
      throw apiError('The apartment search server returned an unrecognized source status.', response.status, refreshRetryAt);
    }
    if (path === 'search' && !isSearchResult(data)) {
      throw apiError('The apartment search server returned an unrecognized search result.', response.status, refreshRetryAt);
    }
    return { ...data, refreshRetryAt } as T;
  }
  return api;
}
