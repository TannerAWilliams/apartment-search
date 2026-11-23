/**
 * The app's connection to its server: the settings and source status it reports, the access token, source
 * checks, and loaders for the data each screen reads. Searches stay in the screen; this hook reads their
 * current filters and version so a source check can refresh the results it shows.
 */
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiConfig, ConfigSource, RefreshInfo } from '../api-client.ts';
import { API_ORIGIN, CHECK_TIME, SEARCH_DEFAULTS, api, failureInfo, finishSourceCheck } from '../app-shared.ts';
import type { AffordableHousing } from '../screens/AffordableHousing.tsx';
import type { AlertState } from '../screens/AlertsPage.tsx';
import type { ListingData, SearchFilters, SearchResult } from '../domain.ts';
import type { Listing } from '../components/Listing.tsx';
import type { RentChart } from '../components/RentChart.tsx';
import { useRetryCooldown } from './app-hooks.ts';
import { localWorkplace, needsCommute } from '../search.ts';
import { encodeSourceImport, retryablePublicSources } from '../source-import.ts';
import { refreshSummary, type SourceDefinition } from '../source-status.ts';
import { savedSessionToken, saveSessionToken } from '../session-token.ts';

type SearchLink = {
  /** The filters of the search on screen, and a number that changes with every new search. */
  appliedFilters: React.RefObject<SearchFilters>;
  searchVersion: React.RefObject<number>;
  /** Whether a search was submitted, so the first saved-inventory search does not replace it. */
  submitted: React.RefObject<boolean>;
  setResult: (result: SearchResult) => void;
  setError: (message: string) => void;
};

export function useServer({ appliedFilters, searchVersion, submitted, setResult, setError }: SearchLink) {
  const [serverState, setServerState] = useState('checking');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [configuredSources, setConfiguredSources] = useState<ConfigSource[]>([]);
  const [companies, setCompanies] = useState<Record<string, number>>({});
  const [sourceCatalog, setSourceCatalog] = useState<SourceDefinition[]>([]);
  const [refresh, setRefresh] = useState<RefreshInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { setRefreshRetryAt, refreshRetryAtRef, cooldownSeconds, setRefreshClock } = useRetryCooldown();
  const [refreshError, setRefreshError] = useState('');
  const browserImportAllowed = useRef(false);
  const checking = useRef<AbortSignal | null>(null);
  const sourceSession = useRef<AbortSignal | null>(null);
  const [activeToken, setActiveToken] = useState('');
  const [commuteConfigured, setCommuteConfigured] = useState(false);
  const [dashboardAvailable, setDashboardAvailable] = useState(false);
  const [account, setAccount] = useState<string | null>(null);

  const failedSources = refresh?.sources.filter(({ status }) => status === 'failed') ?? [];
  const freshness = refreshing
    ? 'Refreshing sources…'
    : failedSources.length
      ? 'Partial coverage · Some sources unavailable'
      : refresh?.lastCheckedAt
        ? 'Saved results · ' + CHECK_TIME.format(new Date(refresh.lastCheckedAt))
        : 'Saved results · Not yet refreshed';

  const updateConfig = useCallback((config: ApiConfig) => {
    const catalog = config.sourceCatalog ?? [];
    // The App Store app leaves out sources read from listing sites' own pages (they have a marketplace, or are Openigloo).
    const scraped = new Set(['openigloo', ...catalog.flatMap(({ id, marketplace }) => (marketplace ? [id, marketplace] : []))]);
    const official = <T extends { id: string }>(sources: T[]) =>
      SEARCH_DEFAULTS.officialOnly ? sources.filter(({ id }) => !scraped.has(id)) : sources;
    setConfiguredSources(official(config.sources));
    setSourceCatalog(official(catalog));
    setCommuteConfigured(config.commuteConfigured === true);
    setDashboardAvailable(config.dashboardAvailable === true);
    setAccount(config.account ?? null);
    setCompanies(config.companies ?? {});
    setRefresh(config.refresh ?? null);
    setRefreshClock(Date.now());
    setRefreshRetryAt(config.refreshRetryAt ?? 0);
    browserImportAllowed.current = config.browserImportAllowed === true;
  }, []);

  const checkSources = useCallback(
    async (source: string | null = null) => {
      const signal = sourceSession.current;
      if (!signal || signal.aborted || checking.current === signal) return;
      if (Date.now() < refreshRetryAtRef.current) return;
      checking.current = signal;
      setRefreshing(true);
      setRefreshError('');
      try {
        const request = await api('refresh', { body: { check: 'now', ...(source ? { source } : {}) }, token: activeToken, signal });
        setRefreshClock(Date.now());
        setRefreshRetryAt(request.refreshRetryAt ?? 0);
        let lastProgress = '';
        const check = await finishSourceCheck(request, activeToken, signal, (progress) => {
          setRefresh(progress);
          const signature = JSON.stringify(progress.sources.map(({ id, listingCount, status }) => [id, listingCount, status]));
          if (signature === lastProgress || signal.aborted) return;
          lastProgress = signature;
          const filters = appliedFilters.current;
          // Progress updates read cached rentals without requesting external geocoding or routing.
          if (needsCommute(filters) || !localWorkplace(filters)) return;
          const version = searchVersion.current;
          void api('search', { body: { ...filters, includeCommute: false }, token: activeToken, signal })
            .then((fresh) => {
              if (!signal.aborted && version === searchVersion.current && filters === appliedFilters.current) setResult(fresh);
            })
            .catch(() => {});
        });
        if (signal?.aborted) return;
        const failedExports = source ? [] : retryablePublicSources(check);
        if (failedExports.length && browserImportAllowed.current) {
          const plan = await api('refresh', { token: activeToken, signal });
          const { pullPublicSources } = await import('../pull-sources.ts');
          const exports = await pullPublicSources(plan, fetch, new Date(), retryablePublicSources(plan));
          if (signal?.aborted) return;
          const recovered = Object.fromEntries(Object.entries(exports).filter(([, data]) => data));
          if (Object.keys(recovered).length) {
            const outcome = await api('refresh', {
              body: { ...encodeSourceImport(recovered), fallback: true },
              token: activeToken,
              signal,
            });
            await finishSourceCheck(outcome, activeToken, signal);
          }
        }

        const config = await api('config', { token: activeToken, signal });
        if (signal?.aborted) return;
        updateConfig(config);
        if (!source) setRefreshError(refreshSummary(config.refresh?.sources ?? []));
        if (source) {
          const status = config.refresh?.sources.find((item) => item.id === source);
          if (status?.status === 'failed')
            setRefreshError(
              (status.error || 'This source could not be fetched.') +
                ' Previously saved listings are preserved; this is not a fresh fetch.',
            );
          else if (check.state === 'already_checked')
            setRefreshError(
              'This source is cooling down. Previously saved listings are shown; try again after the retry time in source status.',
            );
        }
        const filters = appliedFilters.current;
        const version = searchVersion.current;
        const fresh = await api('search', {
          body: { ...filters, includeCommute: config.commuteConfigured === true },
          token: activeToken,
          signal,
        });
        if (!signal?.aborted && searchVersion.current === version && appliedFilters.current === filters) {
          searchVersion.current += 1;
          setResult(fresh);
        }
      } catch (caught) {
        const failure = failureInfo(caught);
        if (failure.refreshRetryAt) {
          setRefreshClock(Date.now());
          setRefreshRetryAt(failure.refreshRetryAt);
        }
        if (!signal?.aborted) setRefreshError(failure.message || 'The listing sources could not be checked.');
      } finally {
        if (checking.current === signal) {
          checking.current = null;
          if (!signal.aborted) setRefreshing(false);
        }
      }
    },
    [activeToken, updateConfig],
  );

  useEffect(() => {
    setServerState('checking');
    const controller = new AbortController();
    sourceSession.current = controller.signal;
    setRefreshing(false);
    api('config', { token: activeToken, signal: controller.signal })
      .then((config) => {
        if (controller.signal.aborted) return;
        setServerState('ready');
        updateConfig(config);
        const version = searchVersion.current;
        if (!submitted.current) {
          api('search', {
            body: { ...SEARCH_DEFAULTS, includeCommute: config.commuteConfigured === true },
            token: activeToken,
            signal: controller.signal,
          })
            .then((fresh) => {
              if (!submitted.current && !controller.signal.aborted && searchVersion.current === version) setResult(fresh);
            })
            .catch((failure) => {
              if (!controller.signal.aborted) setError(failure.message || 'Saved inventory could not be loaded. Please try again.');
            });
        }
        // Opening the app only reads saved inventory; sources are fetched when you resync them.
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setServerState(failure.status === 401 ? 'locked' : 'offline');
      });
    return () => controller.abort();
  }, [activeToken, checkSources, updateConfig, connectionAttempt]);

  const lastCheckedAt = refresh?.lastCheckedAt;
  const loadMarket = useCallback(
    (region: string, grouping: string, signal?: AbortSignal) =>
      api<Awaited<ReturnType<NonNullable<React.ComponentProps<typeof RentChart>['loadMarket']>>>>(
        'market?' + new URLSearchParams({ region, grouping }),
        { token: activeToken, signal },
      ),
    [activeToken, lastCheckedAt],
  );

  /** Reads the market history routes (the paths come from the market history page, not from users). */
  const loadHistory = useCallback(<T>(path: string, signal: AbortSignal) => api<T>(path, { token: activeToken, signal }), [activeToken]);

  const alertRequest = useCallback(
    (body?: unknown) => api<AlertState>('alerts', body ? { body, token: activeToken } : { token: activeToken }),
    [activeToken],
  );
  const loadHousing = useCallback(
    (signal?: AbortSignal) =>
      api<Awaited<ReturnType<NonNullable<React.ComponentProps<typeof AffordableHousing>['loadHousing']>>>>('housing', {
        token: activeToken,
        signal,
      }),
    [activeToken, lastCheckedAt],
  );
  const checkBuilding = useCallback(
    (listing: ListingData, signal?: AbortSignal) =>
      api<Awaited<ReturnType<NonNullable<React.ComponentProps<typeof Listing>['onCheckBuilding']>>>>('building-report', {
        token: activeToken,
        signal,
        body: { address: listing.address, city: listing.city, county: listing.county, state: listing.state, zip: listing.zip },
      }),
    [activeToken],
  );

  /** Tries the server again after it could not be reached. */
  const connect = () => setConnectionAttempt((attempt) => attempt + 1);
  /** Connects again after an email-code sign-in. The native app keeps its session token for next time. */
  const signedIn = (sessionToken: string) => {
    if (sessionToken) {
      setActiveToken(sessionToken);
      void saveSessionToken(sessionToken).catch(() => {});
    }
    setConnectionAttempt((attempt) => attempt + 1);
  };
  /** Ends the email-code session on the server and forgets it here, then shows the sign-in form. */
  const signOut = async () => {
    await fetch(`${API_ORIGIN}/api/auth/sign-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}) },
      credentials: 'include',
      body: '{}',
    }).catch(() => {});
    await saveSessionToken('').catch(() => {});
    setAccount(null);
    setActiveToken('');
    setConnectionAttempt((attempt) => attempt + 1);
  };
  // The native app signs in with the session token it saved last time.
  useEffect(() => {
    void savedSessionToken().then((saved) => {
      if (saved) setActiveToken((current) => current || saved);
    });
  }, []);

  return {
    serverState,
    connect,
    signedIn,
    signOut,
    account,
    configuredSources,
    companies,
    sourceCatalog,
    refresh,
    refreshing,
    refreshError,
    cooldownSeconds,
    activeToken,
    commuteConfigured,
    dashboardAvailable,
    freshness,
    checkSources,
    loadMarket,
    loadHistory,
    alertRequest,
    loadHousing,
    checkBuilding,
  };
}
