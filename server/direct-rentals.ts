import { AFFORDABLE_LIVE } from './affordable-rentals.ts';
import { APARTMENTS_LIVE } from './apartments-com.ts';
import { COMPASS_LIVE } from './compass.ts';
import { REALTOR_LIVE } from './realtor.ts';
import { RENTHOP_LIVE } from './renthop.ts';
import { STREETEASY_LIVE } from './streeteasy.ts';
import { TRULIA_LIVE } from './trulia.ts';
import { ZILLOW_LIVE } from './zillow.ts';
import { ZUMPER_LIVE } from './zumper.ts';
import { HOTPADS_LIVE } from './hotpads.ts';
import { REDFIN_LIVE } from './redfin.ts';
import { APARTMENTLIST_LIVE } from './apartmentlist.ts';
import { CITYREALTY_LIVE } from './cityrealty.ts';
import { GLENWOOD_LIVE } from './glenwood.ts';
import { STUYTOWN_LIVE } from './stuytown.ts';

export const DIRECT_RENTAL_SOURCES = [
  STREETEASY_LIVE,
  ZILLOW_LIVE,
  COMPASS_LIVE,
  RENTHOP_LIVE,
  TRULIA_LIVE,
  ZUMPER_LIVE,
  AFFORDABLE_LIVE,
  REALTOR_LIVE,
  APARTMENTS_LIVE,
  HOTPADS_LIVE,
  REDFIN_LIVE,
  APARTMENTLIST_LIVE,
  CITYREALTY_LIVE,
  // Landlords' own listings.
  STUYTOWN_LIVE,
  GLENWOOD_LIVE,
];
