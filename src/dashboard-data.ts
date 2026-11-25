export const DASHBOARD_URL = 'https://streeteasy.com/blog/data-dashboard/';
export const METRICS = {
  totalInventory: ['Sales inventory', 'count'],
  saleListRatio: ['Sale-to-list ratio', 'ratio'],
  recordedSalesVolume: ['Recorded sales', 'count'],
  priceCutShare: ['Sales price-cut share', 'share'],
  medianAskingPrice: ['Median asking sale price', 'USD'],
  medianSalesPrice: ['Median recorded sale price', 'USD'],
  daysOnMarket: ['Median days on market', 'days'],
  // StreetEasy's repeat-sales and repeat-rent indexes, in dollars at today's level: the same homes over time.
  priceIndex: ['Same-home price', 'USD'],
  rentalInventory: ['Rental inventory', 'count'],
  medianAskingRent: ['Median asking rent', 'USD'],
  discountShare: ['Rental price-cut share', 'share'],
  rentalIndex: ['Same-apartment rent', 'USD'],
} as const;
export type DashboardFile = {
  name: string;
  metric: keyof typeof METRICS;
  segment: string;
  months: string[];
  areas: { name: string; borough: string; type: string; values: (number | null)[] }[];
};
export const DASHBOARD_FILES = Object.keys(METRICS).flatMap((metric) => {
  const segments = metric.endsWith('Index')
    ? ['All']
    : ['rentalInventory', 'medianAskingRent', 'discountShare'].includes(metric)
      ? ['All', 'Studio', 'OneBd', 'TwoBd', 'ThreePlusBd']
      : ['All', 'Coop', 'Condo', 'Sfr'];
  return segments.map((segment) => `${metric}_${segment}.csv`);
});
/** Whether a measure describes the rental or the sales market. */
export const dashboardMarket = (metric: keyof typeof METRICS): 'Rentals' | 'Sales' =>
  ['rentalInventory', 'medianAskingRent', 'discountShare', 'rentalIndex'].includes(metric) ? 'Rentals' : 'Sales';

/** A segment as people say it: 1 bedroom, Co-op. */
export const dashboardSegmentLabel = (segment: string) =>
  ({
    All: 'All',
    Studio: 'Studio',
    OneBd: '1 bedroom',
    TwoBd: '2 bedrooms',
    ThreePlusBd: '3+ bedrooms',
    Coop: 'Co-op',
    Condo: 'Condo',
    Sfr: 'Single-family',
  })[segment] ?? segment;
