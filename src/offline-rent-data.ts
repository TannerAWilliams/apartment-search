import { bundledRentHistory, marketSnapshot } from './bundled-market.ts';

/** Native builds can chart rents with no server, from the bundled snapshot. The web build swaps in offline-rent-data.web.ts. */
export const offlineRentData: { listings(): ReturnType<typeof marketSnapshot>; history: typeof bundledRentHistory } | null = {
  listings: marketSnapshot,
  history: bundledRentHistory,
};
