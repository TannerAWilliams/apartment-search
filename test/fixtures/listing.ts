import type { ListingData } from '../../src/domain.ts';

/** A complete, valid listing for tests, with any fields replaced. */
export const testListing = (fields: Partial<ListingData> = {}): ListingData => ({
  id: 'test-1', address: '12 Grove Street', city: 'Jersey City', state: 'NJ', zip: '07302',
  rent: 2000, bedrooms: 1, kind: 'feed', sources: [], ...fields,
});
