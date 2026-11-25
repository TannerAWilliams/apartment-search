// Renders the app icons in public/icons from one SVG with Playwright's Chromium:
//   bun scripts/make-icons.ts
import { chromium } from 'playwright';

/** The brownstone mark (public/icons/walkup.svg), on its own sky color, inset by `inset` so a maskable icon keeps it in the safe zone. */
const mark = await Bun.file(new URL('../public/icons/walkup.svg', import.meta.url)).text();
const drawing = mark.slice(mark.indexOf('>') + 1, mark.lastIndexOf('</svg>'));
const svg = (size: number, { rounded = true, inset = 0 } = {}) => {
  const pad = size * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="#f1e4cc"/>
    <svg x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" viewBox="0 0 32 32">${drawing}</svg>
  </svg>`;
};

const icons: [string, number, Parameters<typeof svg>[1]?][] = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['maskable-512.png', 512, { rounded: false, inset: 0.14 }],
  ['apple-touch-icon.png', 180, { rounded: false }],
  ['favicon-32.png', 32],
];
// PLAYWRIGHT_CHROMIUM_EXECUTABLE selects an installed Chromium, as in the browser tests.
const browser = await chromium.launch(
  Bun.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: Bun.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] } : {},
);
const page = await browser.newPage();
for (const [name, size, options] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(size, options)}`);
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
console.log('Wrote', icons.map(([name]) => name).join(', '));
