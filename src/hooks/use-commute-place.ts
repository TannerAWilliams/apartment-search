/**
 * Where the person commutes to, kept with them: on their account when signed in (so it follows them to every
 * device), and on this device otherwise. Every new search starts from it, and changing the destination in a
 * search keeps the new one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SearchFilters } from '../domain.ts';
import { WORKPLACES } from '../regions.ts';

export type CommutePlace = Pick<SearchFilters, 'workplace' | 'customWorkplace'>;
const KEY = 'walkup.commute-place';

/** A stored destination the app still knows, or null. */
export function readCommutePlace(value: unknown): CommutePlace | null {
  if (!value || typeof value !== 'object') return null;
  const { workplace, customWorkplace } = value as Record<string, unknown>;
  if (typeof workplace !== 'string' || typeof customWorkplace !== 'string') return null;
  if (workplace === 'custom' ? customWorkplace.trim().length < 4 || customWorkplace.length > 160 : !WORKPLACES[workplace]) return null;
  return { workplace: workplace as SearchFilters['workplace'], customWorkplace: workplace === 'custom' ? customWorkplace : '' };
}
export const samePlace = (a: CommutePlace | null, b: CommutePlace | null) =>
  a?.workplace === b?.workplace && (a?.customWorkplace ?? '') === (b?.customWorkplace ?? '');

export function useCommutePlace(
  account: string | null,
  request: ((place?: CommutePlace | null) => Promise<CommutePlace | null>) | undefined,
  onLoaded: (place: CommutePlace) => void,
) {
  const [place, setPlace] = useState<CommutePlace | null>(null);
  const current = useRef<CommutePlace | null>(null);
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const take = useCallback((next: CommutePlace | null) => {
    current.current = next;
    setPlace(next);
    if (next) loaded.current(next);
  }, []);
  // This device's destination first.
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((value) => {
        const stored = readCommutePlace(value ? JSON.parse(value) : null);
        if (stored && !current.current) take(stored);
      })
      .catch(() => {});
  }, [take]);
  // Then the account's, which wins; an account with none takes this device's.
  useEffect(() => {
    if (!account || !request) return;
    let active = true;
    request()
      .then((stored) => {
        if (!active) return;
        const known = readCommutePlace(stored);
        if (known) {
          if (!samePlace(known, current.current)) take(known);
          AsyncStorage.setItem(KEY, JSON.stringify(known)).catch(() => {});
        } else if (current.current) request(current.current).catch(() => {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [account, request, take]);

  /** Keeps a destination the person chose (or null to forget it), here and on the account. */
  const remember = useCallback(
    (next: CommutePlace | null) => {
      const known = next && readCommutePlace(next);
      if (samePlace(known, current.current)) return;
      current.current = known;
      setPlace(known);
      (known ? AsyncStorage.setItem(KEY, JSON.stringify(known)) : AsyncStorage.removeItem(KEY)).catch(() => {});
      if (account && request) request(known).catch(() => {});
    },
    [account, request],
  );
  return { place, current, remember };
}
