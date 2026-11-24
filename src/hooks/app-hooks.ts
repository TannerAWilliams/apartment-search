import { pathForTab, tabForLocation } from '../routes.ts';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRecord, type ListingData, type SearchResult } from '../domain.ts';
import { mergeListings } from '../listings.ts';

const SAVED_KEY = 'apartment-search:saved-listings:v1';

/**
 * The listings saved on this device: read once, merged with any saved before the read finished,
 * then written back after every change. Failures are reported, and a failed read never overwrites
 * what is stored.
 */
export function useSavedListings(onError: (message: string) => void) {
  const [saved, setSaved] = useState<ListingData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reportError = useRef(onError);
  reportError.current = onError;
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SAVED_KEY)
      .then((value) => {
        if (value && active) {
          const data = JSON.parse(value);
          if (!Array.isArray(data)) throw new Error('Invalid saved listings');
          // Listings this app saved on this device; an entry without an ID is dropped.
          const stored = data.filter((item) => isRecord(item) && typeof item.id === 'string') as ListingData[];
          setSaved((current) => mergeListings([...current, ...stored]));
        }
        if (active) setLoaded(true);
      })
      .catch(() => {
        if (active) reportError.current('Saved listings could not be loaded from this device.');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (loaded)
      AsyncStorage.setItem(SAVED_KEY, JSON.stringify(saved)).catch(() =>
        reportError.current('This device could not store the saved listings.'),
      );
  }, [saved, loaded]);
  return [saved, setSaved] as const;
}

/**
 * Keeps the saved listings on the signed-in account as well as on this device. When an account signs in, its list
 * and this device's are merged; after that every change is sent to the account, a moment after the last one.
 */
export function useAccountSaved(
  saved: ListingData[],
  setSaved: (update: (current: ListingData[]) => ListingData[]) => void,
  account: string | null,
  request: ((listings?: ListingData[]) => Promise<ListingData[]>) | undefined,
  onError: (message: string) => void,
) {
  const [synced, setSynced] = useState<string | null>(null);
  const reportError = useRef(onError);
  reportError.current = onError;
  useEffect(() => {
    setSynced(null);
    if (!account || !request) return;
    let active = true;
    request()
      .then((stored) => {
        if (!active) return;
        setSaved((current) => mergeListings([...stored, ...current]));
        setSynced(account);
      })
      .catch(() => {
        if (active) reportError.current('Your saved listings could not be loaded from your account.');
      });
    return () => {
      active = false;
    };
  }, [account, request, setSaved]);
  useEffect(() => {
    if (!synced || synced !== account || !request) return;
    const timer = setTimeout(() => {
      request(saved).catch(() => reportError.current('Your saved listings could not be saved to your account.'));
    }, 600);
    return () => clearTimeout(timer);
  }, [saved, synced, account, request]);
}

/**
 * The current time, updated when the shown live inventory reaches its expiry and whenever the app
 * returns to the foreground, so the UI can mark expired results without polling or searching.
 */
export function useInventoryClock(result: Pick<SearchResult, 'mode' | 'inventoryExpiresAt'>) {
  const [inventoryClock, setInventoryClock] = useState(Date.now);
  useEffect(() => {
    if (result.mode !== 'live' || result.inventoryExpiresAt === undefined) return;
    const check = () => setInventoryClock(Date.now());
    check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const remaining = Date.parse(result.inventoryExpiresAt!) - Date.now();
      if (!Number.isFinite(remaining) || remaining < 0) {
        check();
        return;
      }
      // setTimeout's maximum delay; longer expiries reschedule.
      timer = setTimeout(
        () => {
          check();
          schedule();
        },
        Math.min(2_147_483_647, remaining + 1),
      );
    };
    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    if (Platform.OS === 'web') window.addEventListener('focus', check);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
      if (Platform.OS === 'web') window.removeEventListener('focus', check);
    };
  }, [result]);
  return inventoryClock;
}

/** The server's refresh retry time and a once-a-second countdown to it. */
export function useRetryCooldown() {
  const [refreshRetryAt, setRefreshRetryAt] = useState(0);
  const refreshRetryAtRef = useRef(0);
  refreshRetryAtRef.current = refreshRetryAt;
  const [refreshClock, setRefreshClock] = useState(Date.now);
  const cooldownSeconds = Math.max(0, Math.ceil((refreshRetryAt - refreshClock) / 1000));
  useEffect(() => {
    if (!refreshRetryAt) return;
    const timer = setInterval(() => setRefreshClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [refreshRetryAt]);
  return { setRefreshRetryAt, refreshRetryAtRef, cooldownSeconds, setRefreshClock };
}

/**
 * The open screen, kept in the URL path on the web (/market, /search, /profile) so links, Back and reload return
 * to it. Changing screen collapses any expanded listing; the Saved screen scopes listing actions to saved apartments.
 */
export function useHashNavigation() {
  const [tab, setTab] = useState('chart');
  const [scope, setScope] = useState('market');
  const [expanded, setExpanded] = useState('');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const restore = () => {
      const next = tabForLocation(window.location.pathname, window.location.hash);
      // A link from before paths ("/#saved") moves to the screen's own address.
      if (window.location.hash) window.history.replaceState(null, '', pathForTab(next) + window.location.search);
      setExpanded('');
      setScope(next === 'saved' ? 'saved' : 'market');
      setTab(next);
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  /** Opens a screen; `replace` changes the address without adding a Back step (for redirects such as the first visit). */
  const navigateTab = (next: string, replace = false) => {
    if (Platform.OS === 'web') {
      const path = pathForTab(next);
      if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
    }
    setScope(next === 'saved' ? 'saved' : 'market');
    setExpanded('');
    setTab(next);
  };
  return { tab, navigateTab, scope, setScope, expanded, setExpanded };
}
