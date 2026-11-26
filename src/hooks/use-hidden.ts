/**
 * Apartments the person does not want to see again: hidden from their results on this device. It is theirs alone;
 * nothing about it is shown to anyone else or changes what others see.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ListingData } from '../domain.ts';
import { listingKey } from '../listings.ts';

const KEY = 'walkup.hidden';
/** The most kept; the oldest are forgotten first. */
const MAX_HIDDEN = 1000;

export const HiddenContext = createContext<{ hidden: ReadonlySet<string>; hide?: (listing: ListingData) => void; showAll?: () => void }>({
  hidden: new Set(),
});

export function useHidden() {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((value) => {
        const stored: unknown = value ? JSON.parse(value) : [];
        if (Array.isArray(stored)) setKeys(stored.filter((key): key is string => typeof key === 'string').slice(-MAX_HIDDEN));
      })
      .catch(() => {});
  }, []);
  const keep = useCallback((next: string[]) => {
    setKeys(next);
    (next.length ? AsyncStorage.setItem(KEY, JSON.stringify(next)) : AsyncStorage.removeItem(KEY)).catch(() => {});
  }, []);
  const hide = useCallback(
    (listing: ListingData) => keep([...keys.filter((key) => key !== listingKey(listing)), listingKey(listing)].slice(-MAX_HIDDEN)),
    [keys, keep],
  );
  const showAll = useCallback(() => keep([]), [keep]);
  return useMemo(() => ({ hidden: new Set(keys) as ReadonlySet<string>, hide, showAll }), [keys, hide, showAll]);
}
