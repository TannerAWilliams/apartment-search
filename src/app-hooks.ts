import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRecord, type ListingData, type SearchResult } from './domain.ts';
import { mergeListings } from './listings.ts';

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
    AsyncStorage.getItem(SAVED_KEY).then((value) => {
      if (value && active) {
        const data = JSON.parse(value);
        if (!Array.isArray(data)) throw new Error('Invalid saved listings');
        // Listings this app saved on this device; an entry without an ID is dropped.
        const stored = data.filter((item) => isRecord(item) && typeof item.id === 'string') as ListingData[];
        setSaved((current) => mergeListings([...current, ...stored]));
      }
      if (active) setLoaded(true);
    }).catch(() => { if (active) reportError.current('Saved listings could not be loaded from this device.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(SAVED_KEY, JSON.stringify(saved))
      .catch(() => reportError.current('This device could not store the saved listings.'));
  }, [saved, loaded]);
  return [saved, setSaved] as const;
}

/** The tabs the URL hash can name; anything else opens Search. */
const APP_TABS = ['results', 'saved', 'more', 'sources', 'chart', 'marketplaces', 'affordable', 'alerts'];

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
      if (!Number.isFinite(remaining) || remaining < 0) { check(); return; }
      // setTimeout's maximum delay; longer expiries reschedule.
      timer = setTimeout(() => { check(); schedule(); }, Math.min(2_147_483_647, remaining + 1));
    };
    schedule();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    if (Platform.OS === 'web') window.addEventListener('focus', check);
    return () => { if (timer !== undefined) clearTimeout(timer); subscription.remove(); if (Platform.OS === 'web') window.removeEventListener('focus', check); };
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
 * The open tab, kept in the URL hash on the web so Back and reload return to it. Changing tab
 * collapses any expanded listing; the Saved tab scopes listing actions to saved apartments.
 */
export function useHashNavigation() {
  const [tab, setTab] = useState('results');
  const [scope, setScope] = useState('market');
  const [expanded, setExpanded] = useState('');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const restore = () => {
      const next = window.location.hash.slice(1);
      setExpanded('');
      setScope(next === 'saved' ? 'saved' : 'market');
      setTab(APP_TABS.includes(next) ? next : 'results');
    };
    restore();
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore); };
  }, []);
  const navigateTab = (next: string) => {
    if (Platform.OS === 'web' && window.location.hash !== '#' + next) window.history.pushState(null, '', '#' + next);
    setScope(next === 'saved' ? 'saved' : 'market');
    setExpanded('');
    setTab(next);
  };
  return { tab, navigateTab, scope, setScope, expanded, setExpanded };
}
