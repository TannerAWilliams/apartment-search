import { AFFORDABLE_LIVE } from './affordable-rentals.mjs';
import { COMPASS_LIVE } from './compass.mjs';
import { REALTOR_LIVE } from './realtor.mjs';
import { RENTHOP_LIVE } from './renthop.mjs';
import { STREETEASY_LIVE } from './streeteasy.mjs';
import { TRULIA_LIVE } from './trulia.mjs';
import { ZILLOW_LIVE } from './zillow.mjs';
import { ZUMPER_LIVE } from './zumper.mjs';

export const DIRECT_RENTAL_SOURCES = [
  STREETEASY_LIVE, ZILLOW_LIVE, COMPASS_LIVE, RENTHOP_LIVE, TRULIA_LIVE, ZUMPER_LIVE, AFFORDABLE_LIVE, REALTOR_LIVE,
];

const FEED_ONLY_MARKETPLACES = new Set(['streeteasy', 'zillow', 'compass', 'renthop', 'realtor']);
export const FEED_ONLY_SOURCES = DIRECT_RENTAL_SOURCES.filter(({ marketplace }) => FEED_ONLY_MARKETPLACES.has(marketplace));
export const AUTO_RENTAL_SOURCES = DIRECT_RENTAL_SOURCES.filter(({ marketplace }) => !FEED_ONLY_MARKETPLACES.has(marketplace));
