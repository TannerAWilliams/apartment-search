/**
 * A screen loaded on first use, like React.lazy, that can also be downloaded ahead of time. Once its code is
 * here it renders at once: React.lazy would still show its fallback first, and React holds a fallback on screen
 * for about 300 ms before showing what replaced it, which made every first visit to a screen feel slow.
 */
import { type ComponentType, createElement, lazy } from 'react';

/** `soon`: the main screens, fetched when the app is first idle; `later`: everything else, some seconds after. */
type Priority = 'soon' | 'later';
const starters: { start: () => Promise<unknown>; priority: Priority }[] = [];

export function preloadable<P extends object>(load: () => Promise<ComponentType<P>>, priority: Priority = 'later'): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const start = () =>
    (pending ??= load().then(
      (component) => {
        loaded = component;
        return { default: component };
      },
      (cause: unknown) => {
        // A failed download can be tried again on the next visit.
        pending = null;
        throw cause;
      },
    ));
  const Lazy = lazy(start);
  starters.push({ start, priority });
  function Preloadable(props: P) {
    return loaded ? createElement(loaded, props) : createElement(Lazy as ComponentType<P>, props);
  }
  return Preloadable;
}

/** Downloads the screens of one priority made with `preloadable`, for when the app is idle. */
export const preloadScreens = (priority: Priority) =>
  Promise.allSettled(starters.filter((item) => item.priority === priority).map(({ start }) => start()));
