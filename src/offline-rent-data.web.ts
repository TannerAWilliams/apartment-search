import type { offlineRentData as native } from './offline-rent-data.ts';

/** The web app is always served by the Worker, so it charts the Worker's rent data and bundles none. */
export const offlineRentData: typeof native = null;
