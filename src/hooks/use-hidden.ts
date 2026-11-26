/**
 * Apartments the person does not want to see again, hidden from their own results. It is theirs alone: nothing
 * about it is shown to anyone else or changes what others see. Signed in, the list is kept on the account, so it
 * follows them to every device; otherwise it stays on this device.
 *
 * An apartment is named by its address and unit (listingKey), so it stays hidden whichever site lists it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListingData } from '../domain.ts';
import { listingKey } from '../listings.ts';

const KEY = 'walkup.hidden';
/** The account this device's list was last matched with, so what was un-hidden elsewhere is not brought back. */
const SYNCED = 'walkup.hidden.account';
/** The most kept; the oldest are forgotten first. */
const MAX_HIDDEN = 1000;

export const HiddenContext = createContext<{ hidden: ReadonlySet<string>; hide?: (listing: ListingData) => void; showAll?: () => void }>({
  hidden: new Set(),
});

/** Reads the account's list (no argument) or replaces it. */
export type HiddenRequest = (keys?: string[]) => Promise<string[]>;

export function useHidden(account: string | null = null, request?: HiddenRequest) {
  const [keys, setKeys] = useState<string[]>([]);
  const send = useRef(request);
  send.current = request;
  const store = useCallback((next: string[]) => {
    setKeys(next);
    (next.length ? AsyncStorage.setItem(KEY, JSON.stringify(next)) : AsyncStorage.removeItem(KEY)).catch(() => {});
  }, []);
  // This device's list first; then the account's, when there is one.
  useEffect(() => {
    let current = true;
    (async () => {
      const value = await AsyncStorage.getItem(KEY).catch(() => null);
      const parsed: unknown = value ? JSON.parse(value) : [];
      const local = Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string').slice(-MAX_HIDDEN) : [];
      if (current) setKeys(local);
      if (!account || !request) return;
      const [onAccount, synced] = await Promise.all([request(), AsyncStorage.getItem(SYNCED).catch(() => null)]);
      if (!current) return;
      // The first time this device meets the account, what was hidden here joins the account's list. After that
      // the account's list is the one to believe: an apartment shown again on another device stays shown.
      const merged = synced === account ? onAccount : [...new Set([...onAccount, ...local])].slice(-MAX_HIDDEN);
      store(merged);
      AsyncStorage.setItem(SYNCED, account).catch(() => {});
      if (merged.length !== onAccount.length) await request(merged);
    })().catch(() => {});
    return () => {
      current = false;
    };
  }, [account, request, store]);
  const keep = useCallback(
    (next: string[]) => {
      store(next);
      // Kept on the account too; if that fails, this device still has it and sends it with the next change.
      send.current?.(next).catch(() => {});
    },
    [store],
  );
  const hide = useCallback(
    (listing: ListingData) => keep([...keys.filter((key) => key !== listingKey(listing)), listingKey(listing)].slice(-MAX_HIDDEN)),
    [keys, keep],
  );
  const showAll = useCallback(() => keep([]), [keep]);
  return useMemo(() => ({ hidden: new Set(keys) as ReadonlySet<string>, hide, showAll }), [keys, hide, showAll]);
}
