/**
 * NYC Housing Connect's open rental lotteries, from the search its own website runs, read once a
 * day with the nightly resync. It is the list people see on housingconnect.nyc.gov: the city's open-data copy of it
 * is republished about monthly, and named lotteries as open weeks after they had closed.
 */
import type { SourceFetch } from '../contracts.ts';
import { isRecord } from '../../src/domain.ts';
import { buildingKey } from '../../src/listings.ts';

const SEARCH = 'https://a806-housingconnectapi.nyc.gov/HPDPublicAPI/api/Lottery/SearchLotteries';
/** The website's search with nothing chosen: every open lottery. */
const EVERYTHING = {
  UnitTypes: [],
  NearbyPlaces: [],
  NearbySubways: [],
  Amenities: [],
  Applied: null,
  HPDUserId: null,
  Boroughs: [],
  Neighborhoods: [],
  HouseholdSize: null,
  Income: null,
  HouseholdType: 1,
  OwnerTypes: [],
  PreferanceTypes: [],
  LotteryTypes: [],
  Min: null,
  Max: null,
  RentalSubsidy: null,
};
const DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const SIZE_FIELDS = ['studios', 'oneBR', 'twoBR', 'threeBR'];
const LARGER_FIELDS = ['fourBR', 'fiveBR', 'sixBR'];

export const housingDate = (now: Date) => DATE.format(now);

const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const count = (value: unknown) => (typeof value === 'number' && value > 0 ? Math.round(value) : 0);
/** The lowest and highest of two amounts, when both are amounts. */
const range = (low: unknown, high: unknown): [number, number] | undefined =>
  typeof low === 'number' && typeof high === 'number' && low >= 0 && high >= low ? [low, high] : undefined;
const titled = (words: string) =>
  words.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_all, gap: string, letter: string) => gap + letter.toUpperCase());

export async function loadHousingConnect(fetcher: SourceFetch, now: Date) {
  const response = await fetcher(SEARCH, {
    method: 'POST',
    redirect: 'manual',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(EVERYTHING),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Housing Connect returned HTTP ' + response.status + '.');
  const answer: unknown = await response.json();
  if (!isRecord(answer) || !Array.isArray(answer.rentals)) throw new Error('The Housing Connect data was invalid.');
  const today = housingDate(now);
  const opportunities = answer.rentals.filter(isRecord).flatMap((row) => {
    const id = typeof row.lotteryId === 'number' && Number.isInteger(row.lotteryId) && row.lotteryId > 0 ? String(row.lotteryId) : '';
    const closes = text(row.lotteryEndDate).slice(0, 10);
    if (!id || !/^\d{4}-\d\d-\d\d$/.test(closes) || closes < today) return [];
    const borough = text(row.borough);
    const places = (Array.isArray(row.markers) ? row.markers : []).filter(isRecord).filter((place) => text(place.address));
    const [latitude, longitude] = [Number(places[0]?.lat), Number(places[0]?.lng)];
    const rents = text(row.rents)
      .split(',')
      .map(Number)
      .filter((rent) => rent > 0);
    return [
      {
        id,
        name: (text(row.lotteryName) || 'Housing Connect lottery').slice(0, 180),
        borough,
        closes,
        sizes: [...SIZE_FIELDS.map((field) => count(row[field])), LARGER_FIELDS.reduce((sum, field) => sum + count(row[field]), 0)],
        addresses: [
          ...new Set(places.map((place) => [titled(text(place.address)), [borough, text(place.zip)].filter(Boolean).join(' ')].join(', '))),
        ].sort(),
        buildingKeys: [
          ...new Set(
            places.flatMap((place) => {
              const zip = text(place.zip);
              const key = /^\d{5}$/.test(zip) ? buildingKey({ address: text(place.address), zip, state: 'NY' }) : null;
              return key ? [key] : [];
            }),
          ),
        ],
        url: 'https://housingconnect.nyc.gov/PublicWeb/details/' + id,
        // Where it is, for the distance to someone's work.
        ...(Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 ? { latitude, longitude } : {}),
        // What it asks, across all its apartments: yearly household income, monthly rent and household size.
        income: range(row.minIncome, row.maxIncome),
        rent: rents.length ? ([Math.min(...rents), Math.max(...rents)] as [number, number]) : undefined,
        household: range(row.minHouseholdSize, row.maxHouseholdSize),
      },
    ];
  });
  opportunities.sort((a, b) => a.closes.localeCompare(b.closes) || Number(a.id) - Number(b.id));
  // The list is the site's own, as of this check.
  return { publishedAt: now.toISOString(), opportunities };
}
