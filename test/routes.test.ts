import { expect, test } from 'bun:test';
import { APP_PATHS, isAppPath, pathForTab, tabForLocation } from '../src/routes.ts';

test('each screen has its own path, and each path opens its screen', () => {
  expect(pathForTab('chart')).toBe('/market');
  expect(pathForTab('results')).toBe('/search');
  expect(pathForTab('more')).toBe('/profile');
  expect(pathForTab('welcome')).toBe('/welcome');
  expect(pathForTab('nowhere')).toBe('/market');
  expect(pathForTab('listing=a%2Fb')).toBe('/listing/a%2Fb');
  for (const tab of ['chart', 'results', 'more', 'saved', 'alerts', 'afford', 'welcome']) expect(tabForLocation(pathForTab(tab))).toBe(tab);
  expect(tabForLocation('/')).toBe('chart');
  expect(tabForLocation('/home')).toBe('chart');
  expect(tabForLocation('/profile/')).toBe('more');
  expect(tabForLocation('/unknown')).toBe('chart');
  expect(tabForLocation('/listing/a%2Fb')).toBe('listing=a%2Fb');
  expect(APP_PATHS).toContain('/search');
});

test('links from before paths still open their screen', () => {
  expect(tabForLocation('/', '#saved')).toBe('saved');
  expect(tabForLocation('/', '#more')).toBe('more');
  expect(tabForLocation('/', '#listing=abc')).toBe('listing=abc');
  expect(tabForLocation('/', '#bogus')).toBe('chart');
});

test('the Worker serves the app for its own paths only', () => {
  expect(isAppPath('/market')).toBe(true);
  expect(isAppPath('/market/')).toBe(true);
  expect(isAppPath('/listing/abc')).toBe(true);
  expect(isAppPath('/')).toBe(true);
  expect(isAppPath('/_expo/static/gone.js')).toBe(false);
  expect(isAppPath('/listing/a/b')).toBe(false);
});
