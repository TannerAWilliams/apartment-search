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

export const HiddenContext = createContext<{
  hidden: ReadonlySet<string>;
  hide?: (listing: ListingData) => void;
  /** Brings one apartment back into the results. */
  unhide?: (listing: ListingData) => void;
  showAll?: () => void;
}>({
  hidden: new Set(),
});

/** Reads the account's list (no argument) or replaces it. */
export type HiddenRequest = (keys?: string[]) => Promise<string[]>;

export function useHidden(account: string | null = null, request?: HiddenRequest) {
  const [keys, setKeys] = useState<string[]>([]);
  const send = useRef(request);
  send.current = request;
  // Counts the person's own changes, so a list that was asked for before one of them cannot undo it.
  const changes = useRef(0);
  const latest = useRef(keys);
  latest.current = keys;
  const signedIn = Boolean(account && request);
  // Until the account's list has been read, changes wait here instead of being sent: sending this device's list
  // first would replace the account's with it. What was shown again meanwhile is remembered, so it stays shown.
  const read = useRef(false);
  const shownAgain = useRef(new Set<string>());
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
      const asked = changes.current;
      // Nothing hidden since the page opened is lost to the list as it was stored.
      if (current && asked === 0) setKeys(local);
      const ask = send.current;
      if (!account || !ask) return;
      read.current = false;
      const [onAccount, synced] = await Promise.all([ask(), AsyncStorage.getItem(SYNCED).catch(() => null)]);
      if (!current) return;
      read.current = true;
      // The person hid or showed something while the account's list was on its way: what the account had joins
      // theirs rather than replacing it, less what they chose to see again, and the whole is sent.
      if (changes.current !== asked) {
        const joined = [...new Set([...onAccount.filter((key) => !shownAgain.current.has(key)), ...latest.current])].slice(-MAX_HIDDEN);
        shownAgain.current.clear();
        store(joined);
        AsyncStorage.setItem(SYNCED, account).catch(() => {});
        await ask(joined);
        return;
      }
      // The first time this device meets the account, what was hidden here joins the account's list. After that
      // the account's list is the one to believe: an apartment shown again on another device stays shown.
      const merged = synced === account ? onAccount : [...new Set([...onAccount, ...local])].slice(-MAX_HIDDEN);
      store(merged);
      AsyncStorage.setItem(SYNCED, account).catch(() => {});
      if (merged.length !== onAccount.length) await ask(merged);
    })().catch(() => {});
    return () => {
      current = false;
    };
  }, [account, signedIn, store]);
  const keep = useCallback(
    (next: string[]) => {
      changes.current += 1;
      for (const key of latest.current) if (!next.includes(key)) shownAgain.current.add(key);
      latest.current = next;
      store(next);
      // Kept on the account too, once its own list is known; if that fails, this device still has it and sends
      // it with the next change.
      if (read.current) send.current?.(next).catch(() => {});
    },
    [store],
  );
  const hide = useCallback(
    (listing: ListingData) => keep([...keys.filter((key) => key !== listingKey(listing)), listingKey(listing)].slice(-MAX_HIDDEN)),
    [keys, keep],
  );
  const unhide = useCallback((listing: ListingData) => keep(keys.filter((key) => key !== listingKey(listing))), [keys, keep]);
  const showAll = useCallback(() => keep([]), [keep]);
  return useMemo(() => ({ hidden: new Set(keys) as ReadonlySet<string>, hide, unhide, showAll }), [keys, hide, unhide, showAll]);
}
