// Renders the app icons in public/icons from one SVG with Playwright's Chromium:
//   bun scripts/make-icons.ts
import { chromium } from 'playwright';

/** A building with lit windows, white on the app's navy. `inset` keeps the glyph in a maskable icon's safe zone. */
const svg = (size: number, { rounded = true, inset = 0.18 } = {}) => {
  const pad = size * inset,
    w = size - pad * 2;
  const x = (f: number) => pad + w * f,
    y = (f: number) => pad + w * f;
  const windows = [0.3, 0.5]
    .flatMap((col) =>
      [0.28, 0.46, 0.64].map(
        (row) => `<rect x="${x(col)}" y="${y(row)}" width="${w * 0.12}" height="${w * 0.1}" rx="${w * 0.015}" fill="#0645c2"/>`,
      ),
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="#06174b"/>
    <rect x="${x(0.2)}" y="${y(0.12)}" width="${w * 0.5}" height="${w * 0.78}" rx="${w * 0.03}" fill="#fff"/>
    <rect x="${x(0.7)}" y="${y(0.42)}" width="${w * 0.14}" height="${w * 0.48}" rx="${w * 0.02}" fill="#c9d8f2"/>
    ${windows}
    <rect x="${x(0.38)}" y="${y(0.78)}" width="${w * 0.14}" height="${w * 0.12}" fill="#06174b"/>
  </svg>`;
};

const icons: [string, number, Parameters<typeof svg>[1]?][] = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['maskable-512.png', 512, { rounded: false, inset: 0.26 }],
  ['apple-touch-icon.png', 180, { rounded: false }],
  ['favicon-32.png', 32, { inset: 0.08 }],
];
// PLAYWRIGHT_CHROMIUM_EXECUTABLE selects an installed Chromium, as in the browser tests.
const browser = await chromium.launch(
  Bun.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: Bun.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
);
const page = await browser.newPage();
for (const [name, size, options] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(size, options)}`);
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
console.log('Wrote', icons.map(([name]) => name).join(', '));
