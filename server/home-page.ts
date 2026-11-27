/**
 * The home page as search engines, AI assistants and link previews read it. The app draws itself in the browser,
 * so the page as sent said only "Loading apartments…": nothing for a crawler that does not run scripts, and
 * nothing to show when the address is pasted into a message. Here the same page is sent with what Walkup is, how
 * much it has today and where its public pages are, written into it; the app replaces that when it starts.
 */
import * as ABOUT from '../src/about-copy.ts';

export type HomeStats = { apartments: number; sites: number };

const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
/** "17,000+": rounded down, so it stays true as listings come and go through the day. */
const rounded = (count: number) => (count >= 1000 ? `${(Math.floor(count / 500) * 500).toLocaleString('en-US')}+` : String(count));

/** What the page says, with today's figures when they are known. */
export function homeCopy(stats: HomeStats | null) {
  const sites = stats && stats.sites > 1 ? `${stats.sites} listing sites` : 'listing sites, brokerages and landlords';
  const apartments = stats && stats.apartments > 0 ? `${rounded(stats.apartments)} rentals` : 'rentals';
  return {
    title: `NYC apartments from ${stats && stats.sites > 1 ? `${stats.sites} sites` : 'across listing sites'} in one search | Walkup`,
    // The same heading the app draws (src/screens/HomePage.tsx), so the page does not change under the reader.
    heading: 'Apartments for rent in and around New York City',
    description:
      `Walkup gathers ${apartments} from ${sites}, shows each apartment once, compares its rent with similar ` +
      'apartments nearby, and grades its building from city records. Free to search, no account needed.',
  };
}

const QUESTIONS: [question: string, answer: string][] = [
  [
    'Is Walkup free?',
    'Searching, saving apartments and checking buildings are free and need no account. One email alert is free; a paid plan sends every match as soon as it is found.',
  ],
  [
    'Where do the apartments come from?',
    'From listing sites, brokerages and landlords’ own sites, read at least once a day. The same apartment on several sites is shown once, with a link to each.',
  ],
  [
    'How do I know if a rent is fair?',
    'Each rent is compared with similar apartments nearby (same size, same area), so a card says how far above or below them it is.',
  ],
  [
    'What is a building grade?',
    'A grade from A to D from New York City’s own records: open housing violations, heat and hot water complaints, bedbugs, rats, evictions and Housing Court cases.',
  ],
];

const LINKS =
  '<p><a href="/search">Search apartments</a> · <a href="/rents">Rents by neighborhood</a> · <a href="/blog">Market reports</a> · ' +
  '<a href="/check-building">Check a building</a> · <a href="/rent-check">Is my rent fair?</a> · ' +
  '<a href="/about">How Walkup works</a> · <a href="/pricing">Pricing</a></p>';
const answers = (questions: [string, string][]) =>
  questions.map(([question, answer]) => `<h2>${escape(question)}</h2><p>${escape(answer)}</p>`).join('');

/**
 * The app's page (`shell`, public/index.html) with one screen's words written into it: its title, description,
 * address and preview for whoever reads the page without running it, and the words themselves where the app
 * will draw.
 */
function written(
  shell: string,
  origin: string,
  path: string,
  { title, heading, description, body, data = [] }: { title: string; heading: string; description: string; body: string; data?: object[] },
) {
  const url = origin + path;
  const head = [
    `<link rel="canonical" href="${escape(url)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Walkup" />',
    `<meta property="og:url" content="${escape(url)}" />`,
    `<meta property="og:title" content="${escape(heading)}" />`,
    `<meta property="og:description" content="${escape(description)}" />`,
    `<meta property="og:image" content="${escape(origin)}/icons/share.png" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    // The data is JSON; "<" is written so that no text in it can end the element.
    ...data.map((entry) => `<script type="application/ld+json">${JSON.stringify(entry).replace(/</g, '\\u003c')}</script>`),
  ].join('\n    ');
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, (_all, before: string, after: string) => before + escape(description) + after)
    .replace('</head>', `  ${head}\n  </head>`)
    .replace(
      /<p class="boot-note">[^<]*<\/p>/,
      `<main class="boot-home"><h1>${escape(heading)}</h1><p>${escape(description)}</p>${body}</main>`,
    );
}

/** The home page: `shell` is the app's own page (public/index.html), sent from `origin`. */
export function homePage(shell: string, origin: string, stats: HomeStats | null) {
  const copy = homeCopy(stats);
  const url = origin + '/';
  return written(shell, origin, '/', {
    ...copy,
    body: LINKS + answers(QUESTIONS),
    data: [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Walkup', url, description: copy.description },
      { '@context': 'https://schema.org', '@type': 'Organization', name: 'Walkup', url, logo: origin + '/icons/icon-512.png' },
    ],
  });
}

/** /about: what Walkup does and the questions people ask about it, as the About screen says them. */
export function aboutPage(shell: string, origin: string) {
  return written(shell, origin, '/about', {
    title: 'How Walkup works: NYC apartment listings from many sites in one search | Walkup',
    heading: 'How Walkup works',
    description: ABOUT.ABOUT_INTRO,
    body: answers(ABOUT.FEATURES) + answers(ABOUT.QUESTIONS) + LINKS,
    data: [
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: ABOUT.QUESTIONS.map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
      },
    ],
  });
}

/** /pricing: what is free and what the paid plan adds, as the Pricing screen says it. */
export function pricingPage(shell: string, origin: string) {
  const { intro, free, paid, monthly, pass } = ABOUT.PRICING;
  return written(shell, origin, '/pricing', {
    title: 'Walkup pricing: free to search, $15 a month for instant alerts | Walkup',
    heading: 'Pricing',
    description: intro,
    body: `<h2>Free: $0</h2><p>${escape(free)}</p><h2>Paid: ${escape(monthly)}, ${escape(pass)}</h2><p>${escape(paid)}</p>${LINKS}`,
  });
}

/** /llms.txt: what the site is and where its public pages are, in plain text, for AI assistants. */
export function llmsFile(origin: string, stats: HomeStats | null) {
  const copy = homeCopy(stats);
  return [
    '# Walkup',
    '',
    `> ${copy.description}`,
    '',
    'Walkup is a search site for rental apartments in New York City and nearby New Jersey. It is free to search and needs no account.',
    '',
    '## What it does',
    '',
    ...QUESTIONS.flatMap(([question, answer]) => [`- ${question} ${answer}`]),
    '',
    '## Pages',
    '',
    `- [Search apartments](${origin}/search): all the listings, with filters for area, size, rent, commute and subway lines.`,
    `- [Rents by neighborhood](${origin}/rents): the median asking rent by size in each New York City neighborhood with apartments listed now, updated daily.`,
    `- [Market reports](${origin}/blog): monthly tables of asking rents by borough and neighborhood, from StreetEasy’s published figures.`,
    `- [Check a building](${origin}/check-building): a New York City building's grade from city records, by address.`,
    `- [Is my rent fair?](${origin}/rent-check): a rent compared with the median for its size and neighborhood.`,
    `- [How Walkup works](${origin}/about)`,
    `- [Pricing](${origin}/pricing)`,
    '',
    '## Using this site',
    '',
    'The rent figures and reports on the pages above may be quoted with a link to the page. Individual listings, and the scores on them, may not be copied or collected in bulk; see the terms.',
    `- [Terms of Service](${origin}/terms)`,
    '',
  ].join('\n');
}
