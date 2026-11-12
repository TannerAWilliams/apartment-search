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

export const DIRECT_RENTAL_SOURCES = [
  STREETEASY_LIVE, ZILLOW_LIVE, COMPASS_LIVE, RENTHOP_LIVE, TRULIA_LIVE, ZUMPER_LIVE, AFFORDABLE_LIVE, REALTOR_LIVE, APARTMENTS_LIVE, HOTPADS_LIVE,
];

const FEED_ONLY_MARKETPLACES = new Set(['zillow', 'compass', 'renthop', 'realtor']);
export const FEED_ONLY_SOURCES = DIRECT_RENTAL_SOURCES.filter(({ marketplace }) => FEED_ONLY_MARKETPLACES.has(marketplace));
export const AUTO_RENTAL_SOURCES = DIRECT_RENTAL_SOURCES.filter(({ marketplace }) => !FEED_ONLY_MARKETPLACES.has(marketplace));
