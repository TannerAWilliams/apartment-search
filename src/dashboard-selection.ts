import { type DashboardFile } from './dashboard-data.ts';
type DashboardChoice = Pick<DashboardFile, 'name' | 'metric' | 'segment'>;
type DashboardMarket = 'Rentals' | 'Sales';
export function dashboardMarket(metric: DashboardFile['metric']): DashboardMarket {
  return ['rentalInventory', 'medianAskingRent', 'discountShare', 'rentalIndex'].includes(metric) ? 'Rentals' : 'Sales';
}
export function dashboardChoices(catalog: readonly DashboardChoice[], selected: string) {
  const current = catalog.find(file => file.name === selected) ?? catalog[0];
  const market = current ? dashboardMarket(current.metric) : 'Rentals';
  return { current, market,
    markets: (['Rentals', 'Sales'] as const).filter(group => catalog.some(file => dashboardMarket(file.metric) === group)),
    metrics: [...new Set(catalog.filter(file => dashboardMarket(file.metric) === market).map(file => file.metric))],
    segments: catalog.filter(file => file.metric === current?.metric),
  };
}
export function selectDashboardMetric(catalog: readonly DashboardChoice[], metric: DashboardFile['metric'], segment = 'All') {
  return catalog.find(file => file.metric === metric && file.segment === segment) ?? catalog.find(file => file.metric === metric);
}
export const dashboardSegmentLabel = (segment: string) => ({ All: 'All', Studio: 'Studio', OneBd: '1 bedroom', TwoBd: '2 bedrooms', ThreePlusBd: '3+ bedrooms', Coop: 'Co-op', Condo: 'Condo', Sfr: 'Single-family' }[segment] ?? segment);
