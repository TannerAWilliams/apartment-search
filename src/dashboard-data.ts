export const DASHBOARD_URL = 'https://streeteasy.com/blog/data-dashboard/';
export const METRICS = {
  totalInventory: ['Sales inventory', 'count'],
  saleListRatio: ['Sale-to-list ratio', 'ratio'],
  recordedSalesVolume: ['Recorded sales', 'count'],
  priceCutShare: ['Sales price-cut share', 'share'],
  medianAskingPrice: ['Median asking sale price', 'USD'],
  medianSalesPrice: ['Median recorded sale price', 'USD'],
  daysOnMarket: ['Median days on market', 'days'],
  priceIndex: ['StreetEasy price index (dollar level)', 'USD'],
  rentalInventory: ['Rental inventory', 'count'],
  medianAskingRent: ['Median asking rent', 'USD'],
  discountShare: ['Rental price-cut share', 'share'],
  rentalIndex: ['StreetEasy rent index (dollar level)', 'USD'],
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
export function formatDashboardValue(value: number | null, metric: keyof typeof METRICS) {
  if (value === null) return 'Not reported';
  const unit = METRICS[metric][1];
  if (unit === 'days' && value < 0) return `${value} days (source anomaly; not a valid duration)`;
  return unit === 'share' || unit === 'ratio'
    ? `${(value * 100).toFixed(2)}%`
    : unit === 'USD'
      ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      : `${value.toLocaleString('en-US')}${unit === 'days' ? ' days' : ''}`;
}
