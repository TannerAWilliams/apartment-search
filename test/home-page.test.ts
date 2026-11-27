import { expect, test } from 'bun:test';
import { aboutPage, homeCopy, homePage, llmsFile, pricingPage } from '../server/home-page.ts';
import { FEATURES, PRICING, QUESTIONS } from '../src/about-copy.ts';
import { robotsFile } from '../server/public-pages.ts';

const SHELL = await Bun.file(new URL('../public/index.html', import.meta.url)).text();
const ORIGIN = 'https://walkup.test';

test('the home page is sent with what Walkup is, today’s figures and what a link preview needs', () => {
  const html = homePage(SHELL, ORIGIN, { apartments: 17_420, sites: 23 });
  expect(html).toContain('<title>NYC apartments from 23 sites in one search | Walkup</title>');
  expect(html).toContain('<h1>New York City apartments from 23 listing sites, in one search</h1>');
  expect(html).toContain('Walkup gathers 17,000+ rentals from 23 listing sites');
  expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/" />`);
  expect(html).toContain(`<meta property="og:image" content="${ORIGIN}/icons/share.png" />`);
  expect(html).toContain('<a href="/rents">Rents by neighborhood</a>');
  expect(html).toContain('<h2>What is a building grade?</h2>');
  // The description is the page's own, in place of the app's general one, and the loading note is gone.
  expect(html.match(/<meta name="description"/g)).toHaveLength(1);
  expect(html).toContain('<meta name="description" content="Walkup gathers 17,000+ rentals');
  expect(html).not.toContain('Loading apartments');
  // Still the app's page: its root, its early requests and its styles are untouched.
  expect(html).toContain('<div id="root"><div class="boot">');
  expect(html).toContain('<script src="/boot.js" async></script>');
  const data = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    ([, json]) => JSON.parse(json!) as Record<string, string>,
  );
  expect(data.map((entry) => entry['@type'])).toEqual(['WebSite', 'Organization']);
  expect(data[0].url).toBe(ORIGIN + '/');
});

test('without figures the page makes no claim about how many, and small counts are said exactly', () => {
  const html = homePage(SHELL, ORIGIN, null);
  expect(html).toContain('<title>NYC apartments from across listing sites in one search | Walkup</title>');
  expect(html).toContain('<h1>New York City apartments from listing sites, brokerages and landlords, in one search</h1>');
  expect(html).not.toMatch(/\d+ (sites|rentals)/);
  expect(homeCopy({ apartments: 0, sites: 1 }).description).toStartWith(
    'Walkup gathers rentals from listing sites, brokerages and landlords',
  );
  expect(homeCopy({ apartments: 640, sites: 5 }).description).toStartWith('Walkup gathers 640 rentals from 5 listing sites');
  // Text is written safely into the page.
  expect(homePage(SHELL, 'https://a.test/?"<x>', null)).toContain('href="https://a.test/?&quot;&lt;x&gt;/"');
});

test('llms.txt says what the site is and where its public pages are', () => {
  const text = llmsFile(ORIGIN, { apartments: 17_420, sites: 23 });
  expect(text).toStartWith('# Walkup\n\n> Walkup gathers 17,000+ rentals from 23 listing sites');
  expect(text).toContain(`- [Rents by neighborhood](${ORIGIN}/rents)`);
  expect(text).toContain('may not be copied or collected in bulk');
  expect(robotsFile(ORIGIN)).toContain('Allow: /llms.txt');
  expect(robotsFile(ORIGIN)).toContain('AI assistants answering a person’s question');
});

test('About and Pricing are sent with their own words, the ones their screens show', () => {
  const about = aboutPage(SHELL, ORIGIN);
  expect(about).toContain('<title>How Walkup works: every NYC apartment listing in one search | Walkup</title>');
  expect(about).toContain(`<link rel="canonical" href="${ORIGIN}/about" />`);
  expect(about).toContain('<h1>How Walkup works</h1>');
  for (const [title] of FEATURES) expect(about).toContain(`<h2>${title}</h2>`);
  const [faq] = [...about.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(
    ([, json]) => JSON.parse(json!) as { '@type': string; mainEntity: { name: string }[] },
  );
  expect(faq!['@type']).toBe('FAQPage');
  expect(faq!.mainEntity.map(({ name }) => name)).toEqual(QUESTIONS.map(([question]) => question));

  const pricing = pricingPage(SHELL, ORIGIN);
  expect(pricing).toContain('<title>Walkup pricing: free to search, $15 a month for instant alerts | Walkup</title>');
  expect(pricing).toContain(`<link rel="canonical" href="${ORIGIN}/pricing" />`);
  expect(pricing).toContain('<h2>Free: $0</h2>');
  expect(pricing).toContain(`<h2>Paid: ${PRICING.monthly}, ${PRICING.pass}</h2>`);
  expect(pricing).not.toContain('ld+json');
  expect(pricing).toContain('<div id="root"><div class="boot">');
});
