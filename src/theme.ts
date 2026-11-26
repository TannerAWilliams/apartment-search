/**
 * Light and dark themes, in the browser. The interface's colors are the palette's (src/palette.ts) by name: each
 * is a CSS variable, set to the palette's own value in the light theme and to the level at the other end of the
 * same hue in the dark one (level 2 becomes level 7), so the palette's contrast rules hold in both. The theme is
 * the device's unless the person chose one on their profile; the choice is kept on the device.
 *
 * The phone app has one theme and uses the palette as it is.
 */
import { type Hue, palette as light } from './palette.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'walkup.theme';
/** The page behind everything, and what is drawn on the accent color. */
export const SURFACE = { light: '#ffffff', dark: '#121212' };
/**
 * The dark theme's grays are neutral: the light theme's warm grays, turned over, read as brown on a dark page.
 * Each is as light as the warm gray it stands for, so the contrast rules are the same.
 */
const NEUTRAL = ['#f6f6f6', '#d5d5d5', '#b8b8b8', '#9e9e9e', '#868686', '#707070', '#5c5c5c', '#484848', '#353535', '#1e1e1e'];
/** Each hue's levels in the dark theme, 0 nearest the page: the other end of the same hue. */
export const darkPalette = Object.fromEntries(
  (Object.keys(light) as Hue[]).map((hue) => [hue, (hue === 'gray' ? NEUTRAL : light[hue]).toReversed()]),
) as { [H in Hue]: string[] };

const hues = Object.keys(light) as Hue[];
const declarations = (dark: boolean) =>
  [
    `--surface:${dark ? SURFACE.dark : SURFACE.light}`,
    `color-scheme:${dark ? 'dark' : 'light'}`,
    ...hues.flatMap((hue) => light[hue].map((color, level) => `--${hue}-${level}:${dark ? darkPalette[hue][level] : color}`)),
  ].join(';');

/** The theme's style sheet: the device's setting unless the page says which. */
export const themeCss = () =>
  `:root{${declarations(false)}}` +
  `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${declarations(true)}}}` +
  `:root[data-theme="dark"]{${declarations(true)}}` +
  // Photographs and maps keep their own colors; the page and the bars take the surface's.
  'html,body{background:var(--surface)}';

/** The page a theme is shown on, and where the choice is kept: the browser's, or stand-ins in a test. */
type Page = {
  documentElement: { dataset: Record<string, string | undefined> };
  head: { append(node: unknown): void };
  createElement(tag: string): { id: string; textContent: string | null };
};
type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

/**
 * The theme for a page: the palette as variables, the choice, and how to show one. Without a page (the phone app,
 * the server) it is the palette as it is, and showing a theme does nothing.
 */
export function themeFor(page: Page | undefined, storage: () => Storage) {
  const palette: { [H in Hue]: readonly string[] } = page
    ? (Object.fromEntries(hues.map((hue) => [hue, light[hue].map((_, level) => `var(--${hue}-${level})`)])) as { [H in Hue]: string[] })
    : light;
  function choice(): ThemeChoice {
    try {
      const stored = page ? storage().getItem(KEY) : null;
      return stored === 'light' || stored === 'dark' ? stored : 'system';
    } catch {
      return 'system';
    }
  }
  /** Shows the chosen theme now and keeps the choice; 'system' follows the device again. */
  function apply(next: ThemeChoice, keep = true) {
    if (!page) return;
    if (next === 'system') delete page.documentElement.dataset.theme;
    else page.documentElement.dataset.theme = next;
    if (!keep) return;
    try {
      if (next === 'system') storage().removeItem(KEY);
      else storage().setItem(KEY, next);
    } catch {
      // Kept for this visit only where storage is off.
    }
  }
  // In the browser the variables exist before anything is drawn with them.
  if (page) {
    const sheet = page.createElement('style');
    sheet.id = 'walkup-theme';
    sheet.textContent = themeCss();
    page.head.append(sheet);
    apply(choice(), false);
  }
  return { palette, surface: page ? 'var(--surface)' : SURFACE.light, choice, apply };
}

const theme = themeFor(typeof document === 'undefined' ? undefined : document, () => localStorage);
/** The palette for the interface: variables in the browser, the palette itself elsewhere. */
export const palette = theme.palette;
/** The page's own color: white in the light theme. */
export const surface = theme.surface;
export const themeChoice = theme.choice;
export const applyTheme = theme.apply;
