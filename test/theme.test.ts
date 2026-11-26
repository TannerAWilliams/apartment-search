import { expect, test } from 'bun:test';
import { palette as light } from '../src/palette.ts';
import { applyTheme, palette, surface, themeChoice, themeCss, themeFor } from '../src/theme.ts';

/** A stand-in page and its storage. */
function browser(stored: Record<string, string> = {}, broken = false) {
  const sheets: { id: string; textContent: string | null }[] = [];
  const page = {
    documentElement: { dataset: {} as Record<string, string | undefined> },
    head: { append: (node: unknown) => void sheets.push(node as (typeof sheets)[number]) },
    createElement: () => ({ id: '', textContent: null }),
  };
  const storage = {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => void (stored[key] = value),
    removeItem: (key: string) => void delete stored[key],
  };
  const theme = themeFor(page, () => {
    if (broken) throw new Error('Storage is off.');
    return storage;
  });
  return { page, sheets, stored, theme };
}

test('outside a browser the theme is the palette itself, and choosing does nothing', () => {
  expect(palette).toBe(light);
  expect(surface).toBe('#ffffff');
  expect(themeChoice()).toBe('system');
  expect(() => applyTheme('dark')).not.toThrow();
});

test('in a browser each color is a variable: the palette in light, the other end of the same hue in dark', () => {
  const { theme, sheets, page } = browser();
  expect(theme.palette.gray[9]).toBe('var(--gray-9)');
  expect(theme.palette.rose[5]).toBe('var(--rose-5)');
  expect(theme.surface).toBe('var(--surface)');
  expect(sheets).toHaveLength(1);
  const css = sheets[0]!.textContent!;
  expect(css).toBe(themeCss());
  // Light: the palette's own values.
  expect(css).toStartWith(':root{--surface:#ffffff;color-scheme:light;--gray-0:' + light.gray[0]);
  // Dark, for a dark device unless light was chosen, and whenever dark was chosen: level 2 is the palette's level 7.
  expect(css).toContain('@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--surface:#141312;color-scheme:dark;');
  expect(css).toContain(':root[data-theme="dark"]{--surface:#141312;');
  expect(css).toContain(`--gray-2:${light.gray[7]}`);
  expect(css).toContain(`--rose-9:${light.rose[0]}`);
  expect(page.documentElement.dataset.theme, 'the device decides until someone chooses').toBeUndefined();
});

test('a chosen theme is shown at once and kept; matching the device forgets it', () => {
  const { theme, page, stored } = browser();
  expect(theme.choice()).toBe('system');
  theme.apply('dark');
  expect(page.documentElement.dataset.theme).toBe('dark');
  expect(stored).toEqual({ 'walkup.theme': 'dark' });
  expect(theme.choice()).toBe('dark');
  theme.apply('system');
  expect(page.documentElement.dataset.theme).toBeUndefined();
  expect(stored).toEqual({});
  // A choice kept from an earlier visit is shown as the page opens; anything else kept there is ignored.
  expect(browser({ 'walkup.theme': 'light' }).page.documentElement.dataset.theme).toBe('light');
  expect(browser({ 'walkup.theme': 'sepia' }).theme.choice()).toBe('system');
  // Where storage is off, a choice still shows, for the visit.
  const off = browser({}, true);
  expect(off.theme.choice()).toBe('system');
  off.theme.apply('dark');
  expect(off.page.documentElement.dataset.theme).toBe('dark');
});

test('the dark theme keeps the palette’s contrast: text five levels from its surface passes, as in the light theme', () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5]
      .map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const dark = Object.fromEntries(Object.entries(light).map(([hue, levels]) => [hue, levels.toReversed()])) as Record<string, string[]>;
  for (const [hue, levels] of Object.entries(dark)) {
    // Text at level 5 or beyond on the page, as the light theme's rule has it.
    for (const level of [5, 6, 7, 8, 9])
      expect(contrast(levels[level]!, '#141312'), `${hue} ${level} on the dark page`).toBeGreaterThanOrEqual(4.5);
    // And on the quiet fill (level 0), five levels apart.
    for (const level of [6, 7, 8, 9])
      expect(contrast(levels[level]!, dark.gray![0]!), `${hue} ${level} on the dark fill`).toBeGreaterThanOrEqual(4.5);
    // The page's own color on the accent levels buttons use (level 5), as white is in the light theme.
    expect(contrast('#141312', levels[5]!), `the page color on ${hue} 5`).toBeGreaterThanOrEqual(4.5);
  }
});
