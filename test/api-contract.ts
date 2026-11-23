/**
 * The API contract, checked by `bun run typecheck`: every reply the server sends (as Hono infers it from
 * the routes in server/api.ts) must have what the app reads from it, with the same types. Changing a reply
 * in a way the app cannot handle fails the type check, before anything ships. Nothing here runs.
 */
import type { hc, InferResponseType } from 'hono/client';
import type { HousingResponse } from '../server/contracts.ts';
import type { ApiRoutes } from '../server/api.ts';
import type { AlertState } from '../src/screens/AlertsPage.tsx';
import type { ApiConfig, RefreshInfo } from '../src/api-client.ts';
import type { BuildingRecordsResult } from '../src/components/BuildingReport.tsx';
import type { DashboardResponse } from '../src/screens/DashboardExplorer.tsx';
import type { Point, SearchResult } from '../src/domain.ts';
import type { RentMarket } from '../src/rent-history.ts';

type Api = ReturnType<typeof hc<ApiRoutes>>['api'];
/** The body of a route's successful (200) reply. */
type Reply<Route> = InferResponseType<Route, 200>;
/** Compiles only when the server's reply can be used as the type the app expects. */
type Fits<Server extends App, App> = [Server, App];

export type ApiContract = [
  Fits<Reply<Api['config']['$get']>, ApiConfig>,
  Fits<Reply<Api['refresh']['$get']>, RefreshInfo>,
  Fits<Reply<Api['refresh']['$post']>, RefreshInfo>,
  Fits<Reply<Api['search']['$post']>, SearchResult>,
  Fits<Reply<Api['market']['$get']>, RentMarket>,
  Fits<Reply<Api['housing']['$get']>, HousingResponse>,
  Fits<Reply<Api['dashboard']['$get']>, DashboardResponse>,
  Fits<Reply<Api['alerts']['$get']>, AlertState>,
  Fits<Reply<Api['alerts']['$post']>, AlertState>,
  Fits<Reply<Api['building-report']['$post']>, BuildingRecordsResult>,
  Fits<Reply<Api['geocode']['$post']>, Point>,
];
