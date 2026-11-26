// Renders the app icons in public/icons from one SVG with Playwright's Chromium:
//   bun scripts/make-icons.ts
import { chromium } from 'playwright';

/**
 * The mark (as in public/icons/walkup.svg) in white on a dark tile, which a home-screen icon needs: the mark alone
 * has no background. It is inset by `inset`, more for a maskable icon, whose edges the phone may cut off.
 */
const drawing =
  '<path fill="#ffffff" d="M5.5 27v-5h7v-5h7v-5h7v15z"/>' +
  '<path fill="#f73b62" d="M19.5 12V4.6a.6.6 0 0 1 .6-.6h5.8a.6.6 0 0 1 .6.6V12z"/>' +
  '<circle cx="21.4" cy="8.4" r=".8" fill="#ffffff"/>';
const svg = (size: number, { rounded = true, inset = 0.14 } = {}) => {
  const pad = size * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="#201e1c"/>
    <svg x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" viewBox="3.5 3 25 25">${drawing}</svg>
  </svg>`;
};

const icons: [string, number, Parameters<typeof svg>[1]?][] = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['maskable-512.png', 512, { rounded: false, inset: 0.22 }],
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
