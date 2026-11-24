/**
 * Plain-English search: "2 bedroom in Brooklyn under $4k with laundry" becomes filters. It reads the words it knows
 * (bedrooms, rent, an area or a neighborhood, pets, laundry, bathrooms, rent stabilization, good buildings and
 * deals) and says what it understood; anything else is left as it was. No text leaves the device.
 */
import type { SearchFilters } from './domain.ts';
import { formatRent } from './search.ts';

export type Understood = { changes: Partial<SearchFilters>; understood: string[] };

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
/** Areas by the words people use for them, longest first so "staten island" wins over "island". */
const AREAS: [RegExp, string, string][] = [
  [/\bstaten island\b/, 'staten-island', 'Staten Island'],
  [/\b(?:the )?bronx\b/, 'bronx', 'The Bronx'],
  [/\bmanhattan\b/, 'manhattan', 'Manhattan'],
  [/\bbrooklyn\b/, 'brooklyn', 'Brooklyn'],
  [/\bqueens\b/, 'queens', 'Queens'],
  [/\b(?:nyc|new york city|five boroughs)\b/, 'nyc', 'New York City'],
  [/\b(?:new jersey|jersey city|hoboken|nj)\b/, 'nj', 'New Jersey'],
  [/\b(?:long island)\b/, 'li', 'Long Island'],
  [/\bwestchester\b/, 'westchester', 'Westchester County'],
  [/\b(?:connecticut|ct)\b/, 'ct', 'Connecticut'],
];
/** The borough each neighborhood's listings name as their city. */
const BOROUGH_KEYS: Record<string, string> = {
  manhattan: 'manhattan',
  brooklyn: 'brooklyn',
  queens: 'queens',
  bronx: 'bronx',
  'staten island': 'staten-island',
};

const key = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The filters a sentence asks for. `neighborhoods` are the known ones with their borough (from the market
 * figures), so "west village" can be recognized.
 */
export function understand(text: string, neighborhoods: { name: string; borough: string }[] = []): Understood {
  const said = ' ' + key(text.replace(/\$/g, ' $')) + ' ';
  const changes: Partial<SearchFilters> = {};
  const understood: string[] = [];

  // Bedrooms: "studio", "2 bedroom", "2br", "two bed", "2 bd".
  if (/\bstudio\b/.test(said)) {
    changes.bedrooms = 0;
    understood.push('Studio');
  } else {
    const beds = said.match(/\b(\d|one|two|three|four|five) ?(?:br|bd|bed|beds|bedroom|bedrooms)\b/);
    if (beds) {
      const count = Math.min(4, NUMBER_WORDS[beds[1]] ?? Number(beds[1]));
      changes.bedrooms = count;
      understood.push(`${count} BR`);
    }
  }

  // Rent: "under 4k", "below $3,500", "max 2500", "less than 3000", "up to 4.5k".
  const rent = text
    .toLowerCase()
    .replace(/,/g, '')
    .match(/(?:under|below|max(?:imum)?|less than|up to|budget(?: of)?|<|for)\s*\$?\s*(\d+(?:\.\d+)?)\s*(k)?\b/);
  if (rent) {
    const amount = Math.round(Number(rent[1]) * (rent[2] ? 1000 : 1));
    if (amount >= 300 && amount <= 100_000) {
      changes.maxRent = amount;
      understood.push('under ' + formatRent(amount));
    }
  }

  // A neighborhood, longest name first, sets its borough too; otherwise an area.
  const known = [...neighborhoods].sort((a, b) => b.name.length - a.name.length);
  const place = known.find(({ name }) => key(name).length > 2 && said.includes(' ' + key(name) + ' '));
  if (place) {
    changes.neighborhood = place.name;
    const borough = BOROUGH_KEYS[key(place.borough)];
    if (borough) changes.region = borough;
    understood.push(place.name);
  } else {
    const area = AREAS.find(([pattern]) => pattern.test(said));
    if (area) {
      changes.region = area[1];
      changes.neighborhood = '';
      understood.push(area[2]);
    }
  }

  if (/\b(?:pets?|dogs?|cats?|pet friendly)\b/.test(said)) {
    changes.petsRequired = true;
    understood.push('pets allowed');
  }
  if (/\b(?:in unit laundry|laundry in unit|washer|w d|in unit washer)\b/.test(said)) {
    changes.laundry = 'in_unit';
    understood.push('in-unit laundry');
  } else if (/\blaundry\b/.test(said)) {
    changes.laundry = 'in_building';
    understood.push('laundry in the building');
  }
  const baths = said.match(/\b(\d(?: 5)?) ?(?:ba|bath|baths|bathroom|bathrooms)\b/);
  if (baths) {
    changes.minBathrooms = Number(baths[1].replace(' ', '.'));
    understood.push(`${changes.minBathrooms}+ baths`);
  }
  if (/\brent (?:stabilized|stabilised|controlled)\b/.test(said)) {
    changes.stabilizedOnly = true;
    understood.push('rent-stabilized');
  }
  if (/\b(?:good|safe|clean|well kept) (?:building|buildings)\b/.test(said)) {
    changes.goodBuildings = true;
    understood.push('good buildings');
  }
  if (/\b(?:deal|deals|cheap|bargain|below market|underpriced)\b/.test(said)) {
    changes.belowMarket = true;
    understood.push('below similar apartments');
  }
  return { changes, understood };
}
