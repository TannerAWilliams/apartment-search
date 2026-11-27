// Renders the app icons in public/icons from one SVG with Playwright's Chromium:
//   bun scripts/make-icons.ts
import { chromium } from 'playwright';

/**
 * The mark (as in public/icons/walkup.svg) in white on a dark tile, which a home-screen icon needs: the mark alone
 * has no background. It is inset by `inset`, more for a maskable icon, whose edges the phone may cut off.
 */
const drawing =
  '<path fill="#ffffff" d="M6.5 28V13.5a9.5 9.5 0 0 1 19 0V28z"/>' + '<path fill="#f73b62" d="M6.5 28v-5.2h6.3v-5.2h6.4v-5.2h6.3V28z"/>';
const svg = (size: number, { rounded = true, inset = 0.14 } = {}) => {
  const pad = size * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="#201e1c"/>
    <svg x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" viewBox="3.5 3 25 25" preserveAspectRatio="xMidYMid meet">${drawing}</svg>
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
// The picture shown when the site's address is pasted into a message or a post (og:image): 1200 by 630.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(
  `<style>html,body{margin:0}body{width:1200px;height:630px;background:#201e1c;color:#fff;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box}
  .brand{display:flex;align-items:center;gap:22px;font-size:64px;font-weight:800;letter-spacing:-2px}
  h1{font-size:68px;line-height:1.08;letter-spacing:-2px;margin:44px 0 22px;max-width:980px}
  p{font-size:32px;line-height:1.35;color:#c9c5c2;margin:0;max-width:940px}</style>
  <div class="brand"><svg width="84" height="84" viewBox="5.5 3 21 25">${drawing}</svg>walkup</div>
  <h1>NYC apartments from across listing sites, in one search</h1>
  <p>Each rent compared with similar apartments. Each building graded from city records.</p>`,
);
await page.screenshot({ path: new URL('../public/icons/share.png', import.meta.url).pathname });
await browser.close();
console.log('Wrote', [...icons.map(([name]) => name), 'share.png'].join(', '));
