/**
 * What Walkup is and what it costs, in words: shown by the About and Pricing screens (src/screens/AboutPage.tsx),
 * and written into those pages as they are sent, for search engines and AI assistants (server/home-page.ts).
 * One copy, so the two never say different things.
 */
export const ABOUT_INTRO =
  'Walkup is a search tool for New York apartments, not a broker. It reads the listing sites, brokerages and landlords, puts every apartment in one search, and checks each against city and state records.';

export const FEATURES: [title: string, body: string][] = [
  [
    'Every listing, one search',
    'Walkup reads listing sites, brokerages and landlords directly and merges them, so the same apartment on three sites shows once and you stop checking ten apps.',
  ],
  ['Know a deal when you see it', 'Every rent is compared with similar apartments nearby, so “12% below similar” means something.'],
  ['Rent-stabilized buildings', 'Built from New York State’s list of about 57,000 registered buildings, with a filter for them.'],
  [
    'Buildings graded A to D',
    'Open violations, complaints, bedbugs, rat inspections, evictions, Housing Court cases and flood zones from city records, before you tour.',
  ],
  ['Alerts within hours', 'New matches are checked every two hours from 8 AM to 10 PM, so you hear first, not the next morning.'],
  ['Search together', 'Share a list with a partner or roommates, vote, leave notes and see everyone’s commute.'],
];
export const QUESTIONS: [question: string, answer: string][] = [
  ['Is Walkup a broker?', 'No. Walkup is a search tool; it never charges a broker fee and doesn’t represent landlords.'],
  [
    'Where do listings come from?',
    'Landlords, management companies, brokerages and listing sites, plus city and state open data about buildings.',
  ],
  ['Can I cancel?', 'Yes, anytime from your Profile. The three-month pass doesn’t renew.'],
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
