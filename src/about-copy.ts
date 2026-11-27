/**
 * What Walkup is and what it costs, in words: shown by the About and Pricing screens (src/screens/AboutPage.tsx),
 * and written into those pages as they are sent, for search engines and AI assistants (server/home-page.ts).
 * One copy, so the two never say different things.
 */
export const ABOUT_INTRO =
  'Walkup is a search tool for apartments in and around New York City. It is not a broker. It reads listings from listing sites, brokerages and landlords, shows each apartment once, and adds what city and state records say about the building.';

export const FEATURES: [title: string, body: string][] = [
  [
    'One list',
    'Listings are read from each source at least once a day and merged. An apartment that is on three sites appears once, with a link to each.',
  ],
  [
    'Rent comparison',
    'Each rent is compared with apartments of the same size nearby. The card says how far above or below them it is, like “12% below similar”.',
  ],
  ['Rent-stabilized buildings', 'Marked from New York State’s list of about 57,000 registered buildings. There is a filter for them.'],
  [
    'Building grades',
    'A to D, from city records: open violations, complaints, bedbugs, rat inspections, evictions, Housing Court cases and flood zones. Not every building has a grade yet.',
  ],
  [
    'Alerts',
    'New matches are checked every two hours from 8 AM to 10 PM and sent by email, and to your phone if you turn notifications on.',
  ],
  ['Shared lists', 'Share a list with a partner or roommates. Each person can vote, leave notes and see their own commute.'],
];
export const QUESTIONS: [question: string, answer: string][] = [
  [
    'Is Walkup a broker?',
    'No. It does not charge a broker fee and does not represent landlords. Each apartment links to its original listing.',
  ],
  [
    'Where do listings come from?',
    'Landlords, management companies, brokerages and listing sites. Building records come from New York City and New York State open data.',
  ],
  ['Can I cancel?', 'Yes, from your Profile, at any time. The three-month pass does not renew.'],
  [
    'What does it cost?',
    'Searching and market data are free without an account. A free account saves apartments and keeps one email alert, sent three hours after a match is found. The paid plan sends every match as soon as it is found.',
  ],
];

export const PRICING = {
  intro: 'Searching is free, and so is one alert. The paid plan tells you about every new match as soon as it is found.',
  free: 'Search every source, deals and warnings, building grades, rent-stabilized buildings and market data, no account needed. A free account adds saved apartments, shared lists and one alert, by email and on your phone, sent three hours after a match is found, up to three a day.',
  paid: 'Everything in Free, plus every new match and price drop sent as soon as it is found (checked every two hours), by email and on your phone, and up to ten alerts.',
  /** The paid plan's prices, as the screen and the page both state them. */
  monthly: '$15 a month',
  pass: 'or $35 for three months, paid once',
};
