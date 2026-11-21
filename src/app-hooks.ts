import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { SearchResult } from './domain.ts';

/** The tabs the URL hash can name; anything else opens Search. */
export const APP_TABS = ['results', 'saved', 'more', 'sources', 'chart', 'marketplaces', 'affordable'];

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
  return { refreshRetryAt, setRefreshRetryAt, refreshRetryAtRef, cooldownSeconds, setRefreshClock };
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
  return { tab, setTab, navigateTab, scope, setScope, expanded, setExpanded };
}
