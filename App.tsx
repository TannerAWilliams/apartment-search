import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, Platform, Pressable, ScrollView, StatusBar, Text, View, useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NYC_COMPANIES } from './src/companies.ts';
import { NYC_SEARCH_AREAS, NYC_SEARCH_DEFAULT, NYC_SEARCH_MARKETS, REGIONS, WORKPLACES, marketsForSearch, matchesRegion, searchBorough } from './src/regions.ts';
import { MARKETPLACE_NAMES, marketplaceLinks } from './src/marketplaces.ts';
import {
  DEFAULT_FILTERS, RESULT_SORTS, bedroomLabel, directionsLink, formatRent, localWorkplace, needsCommute, parseFilters,
} from './src/search.ts';
import { mobileStyles } from './src/mobileStyles.ts';
import { colors, styles } from './src/styles.ts';
import { formatSnapshotMonth, localSearch, SNAPSHOT_SOURCE } from './src/market.ts';
import { listingKey, listingLinkLabel, mergeListings, mergeSourceLinks, orderedListingLinks } from './src/listings.ts';
import { Button, Chip, ExternalLink, Field, Link, SectionTitle } from './src/ui.tsx';
import { encodeSourceImport, pullPublicSources, retryablePublicSources } from './src/pull-sources.ts';
import { AffordableHousing } from './src/AffordableHousing.tsx';
import { AddListing } from './src/AddListing.tsx';
import { ImportListings } from './src/ImportListings.tsx';
import { ListingMap } from './src/ListingMap';
import { SourcesPage } from './src/SourcesPage.tsx';
import { refreshSummary } from './src/source-status.ts';
import { LAUNDRY_LABELS } from './src/discovery.ts';
import { SavedSearches } from './src/SavedSearches.tsx';
import { ObservedChanges } from './src/ObservedChanges.tsx';
import { SavedComparison } from './src/SavedComparison.tsx';
import { TourPlanner } from './src/TourPlanner.tsx';
import { Listing } from './src/Listing.tsx';
import { RentChart } from './src/RentChart.tsx';

const API_ORIGIN = Platform.OS === 'web' ? '' :
  (process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || null);
const WEB_MAP = Platform.OS === 'web';
const SEARCH_DEFAULTS = { ...DEFAULT_FILTERS, region: 'all', bedrooms: null, maxRent: null, source: '', includeMap: WEB_MAP, liveOnly: true };
const BEDROOMS = [null, 0, 1, 2, 3, 4];
const PAGE_SIZE = 12;
const EMPTY_POINTS = [];
const SAVED_KEY = 'apartment-search:saved-listings:v1';
const SAVED_FILTERS = { ...SEARCH_DEFAULTS, bedrooms: null, maxRent: null, liveOnly: false };
const CHECK_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

const formDefaults = () => ({
  ...SEARCH_DEFAULTS,
  maxRent: SEARCH_DEFAULTS.maxRent == null ? '' : String(SEARCH_DEFAULTS.maxRent),
  maxTransitMinutes: '',
  maxDrivingMinutes: '',
});

async function api(path: string, { body, token, signal }: { body?: object; token?: string; signal?: AbortSignal } = {}) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_ORIGIN}/api/${path}`, {
    method: body ? 'POST' : 'GET', headers, signal,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  const wait = Number(response.headers.get('X-Refresh-Retry-After') ?? (response.status === 429 ? response.headers.get('Retry-After') : 0));
  const refreshRetryAt = Number.isFinite(wait) && wait > 0 ? Date.now() + wait * 1000 : 0;
  data.refreshRetryAt = refreshRetryAt;
  if (!response.ok) {
    const error = Object.assign(new Error(data.error || 'Could not reach the apartment search server.'), {
      refreshRetryAt, status: response.status, commuteError: data.commuteError === true,
    });
    throw error;
  }
  return data;
}

async function finishSourceCheck(check, token, signal) {
  for (let attempt = 0; check.checking && attempt < 125; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (signal?.aborted) return check;
    check = await api('refresh', { token, signal });
  }
  if (check.checking) throw new Error('The source check is still running.');
  return check;
}

function Filters({ draft, setDraft, submit, busy, serverState, token, setToken, connect, panel, commuteConfigured }) {
  const set = (field) => (value) => setDraft((previous) => ({ ...previous, [field]: value }));

  return <View style={styles.filters}>
    {(panel === 'more' || panel === 'beds') && <>
    <Text style={styles.fieldLabel}>Bedrooms</Text>
    <View style={styles.chipRow}>
      {BEDROOMS.map((beds) => <Chip key={String(beds)} selected={draft.bedrooms === beds}
        onPress={() => set('bedrooms')(beds)}>{beds === null ? 'Any' : beds === 0 ? 'Studio' : `${beds} BR`}</Chip>)}
    </View>
    </>}
    {(panel === 'more' || panel === 'area') && <>
    <Text style={styles.fieldLabel}>Area</Text>
    <View style={styles.chipRow}>
      {Object.entries({ all: REGIONS.all, nyc: REGIONS.nyc, nj: REGIONS.nj, ct: REGIONS.ct, li: REGIONS.li, metroNorth: REGIONS.metroNorth, ...NYC_SEARCH_AREAS }).map(([key, region]) => <Chip key={key} selected={draft.region === key}
        onPress={() => set('region')(key)}>{region.label}</Chip>)}
    </View>
    <Field label="ZIP code (optional)" placeholder="Any ZIP in this area" value={draft.zip}
      onChangeText={set('zip')} keyboardType="number-pad" maxLength={5} />
    </>}
    {(panel === 'more' || panel === 'price') && <>
      <Field label="Max rent per month ($)" placeholder="Any rent" value={draft.maxRent}
        onChangeText={set('maxRent')} keyboardType="number-pad" maxLength={6} />
      <View style={styles.chipRow}>
        <Chip selected={draft.maxRent === ''} onPress={() => set('maxRent')('')}>Any price</Chip>
        <Chip selected={draft.maxRent === String(DEFAULT_FILTERS.maxRent)}
          onPress={() => set('maxRent')(String(DEFAULT_FILTERS.maxRent))}>Up to {formatRent(DEFAULT_FILTERS.maxRent)}</Chip>
      </View>
    </>}
    {panel === 'more' && <>

    <Text style={styles.fieldLabel}>Best-fit priorities</Text>
    <Field label="Rent ranking weight (0–100)" value={String(draft.bestFitRentWeight ?? 60)} onChangeText={set('bestFitRentWeight')} keyboardType="number-pad" maxLength={3} />
    <Text style={styles.smallMuted}>Commute receives the remaining weight out of 100. Applies to Best fit sorting only. Missing estimates earn no points; changing weights does not request a route.</Text>
    <View style={styles.chipRow}>
      {[0, 25, 50, 60, 75, 100].map(weight => <Chip key={weight} selected={Number(draft.bestFitRentWeight ?? 60) === weight} onPress={() => set('bestFitRentWeight')(weight)}>Rent {weight} / commute {100 - weight}</Chip>)}
    </View>
    <Text style={styles.fieldLabel}>Reported apartment features</Text>
    <Text style={styles.smallMuted}>Filters require explicit source data. Unknown details are excluded when a feature is required; verify with the landlord.</Text>
    <Field label="Minimum bathrooms" value={draft.minBathrooms == null ? '' : String(draft.minBathrooms)} onChangeText={set('minBathrooms')} placeholder="Any / unknown allowed" keyboardType="decimal-pad" />
    <Field label="Minimum square feet" value={draft.minSquareFeet == null ? '' : String(draft.minSquareFeet)} onChangeText={set('minSquareFeet')} placeholder="Any / unknown allowed" keyboardType="number-pad" />
    <View style={styles.chipRow}>
      <Chip selected={draft.petsRequired === true} onPress={() => set('petsRequired')(!draft.petsRequired)}>Require pets allowed</Chip>
      <Chip selected={!draft.laundry} onPress={() => set('laundry')('')}>Any laundry / unknown allowed</Chip>
      {Object.entries(LAUNDRY_LABELS).map(([value, label]) => <Chip key={value} selected={draft.laundry === value} onPress={() => set('laundry')(value)}>{label}</Chip>)}
    </View>

    <Field label="Listing company (optional)" placeholder="Compass, SERHANT., Corcoran…" value={draft.company}
      onChangeText={set('company')} maxLength={80} />

    <View style={styles.divider} />
    </>}
    {(panel === 'more' || panel === 'commute') && <>
    <SectionTitle index="02">Work commute</SectionTitle>
    <Text style={styles.fieldLabel}>Workplace</Text>
    <View style={styles.chipRow}>
      {Object.entries(WORKPLACES).map(([key, workplace]) => <Chip key={key}
        selected={draft.workplace === key} onPress={() => set('workplace')(key)}>{workplace.label}</Chip>)}
      <Chip selected={draft.workplace === 'custom'} onPress={() => set('workplace')('custom')}>Custom</Chip>
    </View>
    {draft.workplace === 'custom' && <Field label="Workplace street address or coordinates"
      placeholder={serverState === 'ready' ? 'Street, city, state, ZIP' : '40.75874, -73.97867'}
      value={draft.customWorkplace} onChangeText={set('customWorkplace')} maxLength={160} />}
    {commuteConfigured ? <>
    <Field label="Max transit time (minutes)" placeholder="Any transit time" value={draft.maxTransitMinutes ?? ''}
      onChangeText={set('maxTransitMinutes')} keyboardType="number-pad" maxLength={3} />
    <Field label="Max driving time (minutes)" placeholder="Any driving time" value={draft.maxDrivingMinutes ?? ''}
      onChangeText={set('maxDrivingMinutes')} keyboardType="number-pad" maxLength={3} />
    <Text style={styles.smallMuted}>Estimates are for arriving at your workplace on a weekday morning. Set both limits to require both.</Text>
    </> : <Text style={styles.smallMuted}>Automatic transit and driving estimates are currently unavailable.</Text>}
    </>}
    {serverState === 'locked' && <View style={styles.tokenForm}>
      <Field label="Server access token" placeholder="Enter your server token" value={token}
        onChangeText={setToken} secureTextEntry maxLength={256} />
      <Button secondary onPress={connect}>Connect to server</Button>
    </View>}
    <View style={styles.submit}>
      <Button onPress={submit} disabled={busy}>{busy ? 'Searching…' : 'Search apartments →'}</Button>
      <Pressable accessibilityRole="button" onPress={() => setDraft(formDefaults())} style={styles.reset}>
        <Text style={styles.linkText}>Reset filters</Text>
      </Pressable>
    </View>
  </View>;
}

function Marketplaces({ filters, sources, configuredSources, companies, onCompany, refresh, refreshing, cooldownSeconds, onRefresh, onError }) {
  const markets = marketsForSearch(filters);
  const [marketLabel, setMarketLabel] = useState('');
  const market = markets.find((item) => item.label === marketLabel) ??
    markets.find((item) => item.zip === filters.zip) ?? markets[0];
  const searchFeeds = new Set(sources.filter(({ status }) => status === 'searched').map(({ id }) => id));
  const configured = new Set(configuredSources.map(({ id }) => id));
  const sampleNames = configuredSources.filter(({ sample }) => sample).map(({ name }) => name);
  const unavailable = new Set(sources.filter(({ status }) => status === 'unavailable').map(({ id }) => id));
  const feedRequired = new Set(refresh?.sources.filter(({ status }) => status === 'feed_required').map(({ marketplace }) => marketplace));

  return <View style={styles.marketplacePanel}>
    <Text accessibilityRole="header" style={styles.panelTitle}>Browse rental platforms</Text>
    <View style={styles.chartSource}>
      <Text style={styles.fieldLabel}>Search several NYC sites at once</Text>
      <Link label="RentReboot" url="https://rentreboot.com/" onError={onError} />
      <Link label="Lessia’s List" url="https://lessiaslist.com/" onError={onError} />
    </View>
    <Text style={styles.bodyText}>Live results come from recent marketplace checks. FirstMover’s {formatSnapshotMonth(refresh?.sources.find(({ id }) => id === 'firstmover')?.month)} snapshot supplies the rent charts.</Text>
    <View style={styles.chartSource}>
      <Text style={styles.fieldLabel}>{sampleNames.length ? sampleNames.length + ' live listing sources' : 'Recent live samples unavailable'}</Text>
      {sampleNames.length > 0 && <Text style={styles.smallMuted}>{sampleNames.join(' · ')}</Text>}
      <Link label="FirstMover Open Data" url={SNAPSHOT_SOURCE} onError={onError} />
      <Text style={styles.smallMuted}>Settled.nyc · source access unverified.</Text>
    </View>
    <Text style={styles.fieldLabel}>Marketplace area</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.marketChips}>
      {markets.map((item) => <Chip key={item.label} selected={item === market}
        onPress={() => setMarketLabel(item.label)}>{item.label}</Chip>)}
    </ScrollView>
    {filters.zip !== '' && <Text style={styles.smallMuted}>ZIP {filters.zip} is used on platforms with ZIP searches.</Text>}
    <View style={styles.marketGrid}>
      {marketplaceLinks(market, filters).map(({ id, name, url, detail }) =>
        <ExternalLink key={id} url={url} onError={onError} accessibilityLabel={`Open ${name}, ${detail}`}
          style={({ pressed }) => [styles.marketCard, pressed && styles.pressed]}>
          <View style={styles.marketInfo}>
            <Text style={styles.marketName}>{name}</Text>
            <Text style={styles.smallMuted}>{detail}</Text>
          </View>
          <Text style={styles.marketArrow}>↗</Text>
          <Text style={styles.marketType}>{configuredSources.some((source) => source.id === id && source.sample) ?
            'LIMITED LIVE SAMPLE' : searchFeeds.has(id) ? 'FREE LIVE FEED' : unavailable.has(id) ? 'FEED UNAVAILABLE' :
            configured.has(id) ? 'FREE FEED CONFIGURED' : feedRequired.has(id) ? 'AUTHORIZED FEED REQUIRED' : 'BROWSE ONLY'}</Text>
        </ExternalLink>)}
    </View>
    <Text accessibilityRole="header" style={styles.panelTitle}>NYC brokerages and apartment companies</Text>
    <Text style={styles.bodyText}>Counts come from the dated StreetEasy export. Open a company’s website for its current listings.</Text>
    <View style={styles.marketGrid}>
      {NYC_COMPANIES.map(({ id, name, url, type }) => <View key={id} style={[styles.chartCard, { flexGrow: 1, flexBasis: '46%', minWidth: 150 }]}>
        <Text style={styles.marketName}>{name}</Text>
        <Text style={styles.smallMuted}>{type} · {configured.has(id) ? 'Feed configured' :
          companies[id] ? companies[id].toLocaleString('en-US') + ' in the snapshot' : 'Website link'}
          {feedRequired.has(id) && !configured.has(id) ? ' · Authorized feed required' : ''}</Text>
        {configured.has(id) && <Button secondary onPress={() => onCompany(name)}>Search in Apartment Search</Button>}
        <Link label="Company website" url={url} onError={onError} />
      </View>)}
    </View>
  </View>;
}

function ResultNotices({ notices = [] }) {
  const [expanded, setExpanded] = useState(false);
  if (!notices.length) return null;
  return <View style={styles.noticePanel}>
    <Text style={styles.fieldLabel}>Source coverage</Text>
    {expanded ? notices.map((notice, index) => <Text key={`${index}-${notice}`} style={styles.bodyText}>• {notice}</Text>) :
      <Text style={styles.bodyText}>{notices.length} source coverage {notices.length === 1 ? 'note' : 'notes'}. Review before relying on result completeness.</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.link}>
      <Text style={styles.linkText}>{expanded ? 'Hide coverage notes' : 'Show coverage notes'}</Text>
    </Pressable>
  </View>;
}

function Results({ visible, setVisible, result, applied, sort, onSort, onPage, paging, openCommute, commuteConfigured, checkingInventory, columns, savedByKey, showMarkets, onSave, onSaveLink, onRemove, onError, onCheckBuilding }) {
  const { matches } = result;
  const savedView = result.mode === 'saved';
  const summary = savedView ? 'Saved on this device · All apartment sizes' : [
    REGIONS[applied.region].label, bedroomLabel(applied.bedrooms), applied.zip, applied.company, MARKETPLACE_NAMES[applied.source],
    applied.maxRent === null ? null : `Up to ${formatRent(applied.maxRent)}`,
    applied.maxTransitMinutes == null ? null : `Transit ≤ ${applied.maxTransitMinutes} min`,
    applied.maxDrivingMinutes == null ? null : `Drive ≤ ${applied.maxDrivingMinutes} min`,
  ].filter(Boolean).join(' · ');

  return <>
    <View style={styles.resultHeading}>
      <View style={styles.headingCopy}>
        <Text accessibilityRole="header" style={styles.panelTitle}>{!savedView && checkingInventory && result.total === 0 ?
          'Checking availability…' : `${result.total.toLocaleString('en-US')} ${savedView ? 'saved' : 'matching'} ${result.total === 1 ? 'apartment' : 'apartments'}`}</Text>
        <Text style={styles.smallMuted}>{summary}</Text>
        <Text style={styles.smallMuted}>To {result.workplace.label}</Text>
      </View>
      <View style={styles.chipRow}>
        {Object.entries(RESULT_SORTS).filter(([id]) => id === 'rent' || (!savedView && id === 'best') ||
          (!savedView && commuteConfigured && id !== 'recent')).map(([id, label]) =>
          <Chip key={id} selected={sort === id} onPress={() => onSort(id)}>{label}</Chip>)}
      </View>
    </View>
    {result.commute && <Text style={styles.smallMuted}>Weekday-morning estimates from TravelTime.</Text>}
    {result.commuteNotice && <Text style={styles.smallMuted}>{result.commuteNotice}</Text>}
    <ResultNotices notices={result.notices} />
    {result.total > matches.length && <Text style={styles.smallMuted}>Showing records {(result.offset ?? 0) + (matches.length ? 1 : 0)}–{(result.offset ?? 0) + matches.length} of {result.total}.</Text>}
    {matches.length === 0 && (savedView || !checkingInventory) && <View style={styles.empty}>
      <Text accessibilityRole="header" style={styles.panelTitle}>{savedView ? 'Your saved list is empty' : 'No recently checked matches'}</Text>
      <Text style={styles.bodyText}>{savedView ? 'Save a result or add an apartment you found on a rental platform.' :
        applied.source ? 'This website has no recently checked matches. Check its website for current availability.' :
          needsCommute(applied) ? 'Try a longer commute limit, or change the area or budget.' :
            'Try another area, website, bedroom count, or budget.'}</Text>
      {!savedView && needsCommute(applied) && <Button secondary onPress={openCommute}>Edit commute filters</Button>}
      <Button secondary onPress={showMarkets}>Browse rental platforms</Button>
    </View>}
    <View style={styles.listingGrid}>
    {matches.slice(0, visible).map((listing) => {
      const saved = savedByKey.get(listingKey(listing));
      const withLinks = saved ? { ...listing, sources: mergeSourceLinks(listing.sources, saved.sources) } : listing;
      return <View key={listing.id} style={columns ? styles.gridCard : styles.fullCard}><Listing listing={withLinks} selectedSource={savedView ? '' : applied.source} workplace={result.workplace} commute={result.commute}
        onCheckBuilding={onCheckBuilding} onSave={onSave} onSaveLink={onSaveLink} onError={onError} onRemove={savedView ? onRemove : null} saved={Boolean(saved)} /></View>;
    })}
    </View>
    {!savedView && onPage && <View style={styles.chipRow}>
      {(result.offset ?? 0) > 0 && <Button secondary disabled={paging} onPress={() => onPage(Math.max(0, result.offset - result.pageSize))}>Previous 100</Button>}
      {result.nextOffset != null && <Button secondary disabled={paging} onPress={() => onPage(result.nextOffset)}>Next 100</Button>}
    </View>}
    {visible < matches.length && <Button secondary onPress={() => setVisible(visible + PAGE_SIZE)}>
      Show more ({Math.min(visible, matches.length)} of {matches.length})
    </Button>}
  </>;
}

function WebsiteFilter({ result, applied, onSelect, onError }) {
  const counts = result.sourceCounts ?? [];
  const streetEasy = counts.find(({ id }) => id === 'streeteasy');
  const areas = marketsForSearch(applied);

  return <View style={styles.websiteFilter}>
    <Text style={styles.fieldLabel}>Listing website</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marketChips}>
      <Chip selected={!applied.source} onPress={() => onSelect('')}>All websites</Chip>
      <Chip selected={applied.source === 'streeteasy'} onPress={() => onSelect('streeteasy')}>
        {'StreetEasy' + (streetEasy ? ' (' + streetEasy.count.toLocaleString('en-US') + ')' : '')}
      </Chip>
      {counts.filter(({ id }) => id !== 'streeteasy').map(({ id, name, count }) =>
        <Chip key={id} selected={applied.source === id} onPress={() => onSelect(id)}>{name + ' (' + count.toLocaleString('en-US') + ')'}</Chip>)}
    </ScrollView>
    {applied.source === 'streeteasy' && <View style={styles.actionLinks}>
      {(!streetEasy || !streetEasy.checkedCount) && <Text style={styles.smallMuted}>StreetEasy’s dated export supplies rent charts. Browse StreetEasy for its current listings.</Text>}
      {areas.map((area) => <Link key={area.label} label={`Browse ${area.label} on StreetEasy`}
        url={marketplaceLinks(area, applied).find(({ id }) => id === 'streeteasy').url} onError={onError} />)}
    </View>}
  </View>;
}

function ApartmentSearch() {
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  const [draft, setDraft] = useState(formDefaults);
  const [applied, setApplied] = useState(SEARCH_DEFAULTS);
  const [result, setResult] = useState(() => localSearch([], SEARCH_DEFAULTS, localWorkplace(SEARCH_DEFAULTS), 'live'));
  const [saved, setSaved] = useState([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => { setVisible(PAGE_SIZE); }, [result]);
  const [storageReady, setStorageReady] = useState(false);
  const [serverState, setServerState] = useState(API_ORIGIN === null ? 'offline' : 'checking');
  const [configuredSources, setConfiguredSources] = useState([]);
  const [companies, setCompanies] = useState({});
  const [sourceCatalog, setSourceCatalog] = useState([]);
  const [refresh, setRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshRetryAt, setRefreshRetryAt] = useState(0);
  const refreshRetryAtRef = useRef(0);
  refreshRetryAtRef.current = refreshRetryAt;
  const [refreshClock, setRefreshClock] = useState(Date.now);
  const cooldownSeconds = Math.max(0, Math.ceil((refreshRetryAt - refreshClock) / 1000));
  useEffect(() => {
    if (!refreshRetryAt) return;
    const timer = setInterval(() => setRefreshClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [refreshRetryAt]);
  const [refreshError, setRefreshError] = useState('');
  const browserImportAllowed = useRef(false);
  const checking = useRef(null);
  const sourceSession = useRef(null);
  const submitted = useRef(false);
  const searchVersion = useRef(0);
  const appliedFilters = useRef(SEARCH_DEFAULTS);
  const [token, setToken] = useState('');
  const [activeToken, setActiveToken] = useState('');
  const [commuteConfigured, setCommuteConfigured] = useState(false);
  const [tab, setTab] = useState('results');
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const restore = () => {
      const next = window.location.hash.slice(1);
      setExpanded('');
      setScope(next === 'saved' ? 'saved' : 'market');
      setTab(['results', 'saved', 'more', 'sources', 'chart', 'marketplaces', 'affordable'].includes(next) ? next : 'results');
    };
    restore();
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore); };
  }, []);
  const navigateTab = (next) => {
    if (Platform.OS === 'web' && window.location.hash !== '#' + next) window.history.pushState(null, '', '#' + next);
    setScope(next === 'saved' ? 'saved' : 'market');
    setExpanded('');
    setTab(next);
  };
  const [scope, setScope] = useState('market');
  const [adding, setAdding] = useState<false | 'single' | 'import'>(false);
  const [expanded, setExpanded] = useState('');
  const [mapView, setMapView] = useState(false);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: scrollPositions.current[tab] ?? 0, animated: false }));
    return () => cancelAnimationFrame(frame);
  }, [tab]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const failedSources = refresh?.sources.filter(({ status }) => status === 'failed') ?? [];
  const savedByKey = useMemo(() => new Map(saved.map((listing) => [listingKey(listing), listing])), [saved]);
  const savedResults = useMemo(() => localSearch(saved, SAVED_FILTERS, result.workplace, 'saved'), [saved, result.workplace]);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SAVED_KEY).then((value) => {
      if (value && active) {
        const data = JSON.parse(value);
        if (!Array.isArray(data)) throw new Error('Invalid saved listings');
        setSaved((current) => mergeListings([...current, ...data]));
      }
      if (active) setStorageReady(true);
    }).catch(() => { if (active) setError('Saved listings could not be loaded from this device.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (storageReady) AsyncStorage.setItem(SAVED_KEY, JSON.stringify(saved))
      .catch(() => setError('This device could not store the saved listings.'));
  }, [saved, storageReady]);

  const updateConfig = useCallback((config) => {
    setConfiguredSources(config.sources);
    setSourceCatalog(config.sourceCatalog ?? []);
    setCommuteConfigured(config.commuteConfigured === true);
    setCompanies(config.companies ?? {});
    setRefresh(config.refresh ?? null);
    setRefreshClock(Date.now());
    setRefreshRetryAt(config.refreshRetryAt ?? 0);
    browserImportAllowed.current = config.browserImportAllowed === true;
  }, []);

  const checkSources = useCallback(async (sessionStart = false, source: string | null = null) => {
    const signal = sourceSession.current;
    if (!signal || signal.aborted || checking.current === signal) return;
    if (Date.now() < refreshRetryAtRef.current) return;
    checking.current = signal;
    setRefreshing(true);
    setRefreshError('');
    try {
      const request = await api('refresh', { body: { check: 'now', sessionStart, ...(source ? { source } : {}) }, token: activeToken, signal });
      setRefreshClock(Date.now());
      setRefreshRetryAt(request.refreshRetryAt ?? 0);
      const check = await finishSourceCheck(request, activeToken, signal);
      if (signal?.aborted) return;
      const failedExports = source ? [] : retryablePublicSources(check);
      if (failedExports.length && browserImportAllowed.current) {
        const plan = await api('refresh', { token: activeToken, signal });
        const exports = await pullPublicSources(plan, fetch, new Date(), retryablePublicSources(plan));
        if (signal?.aborted) return;
        const recovered = Object.fromEntries(Object.entries(exports).filter(([, data]) => data));
        if (Object.keys(recovered).length) {
          const outcome = await api('refresh', { body: { ...encodeSourceImport(recovered), fallback: true }, token: activeToken, signal });
          await finishSourceCheck(outcome, activeToken, signal);
        }
      }

      const config = await api('config', { token: activeToken, signal });
      if (signal?.aborted) return;
      updateConfig(config);
      if (!source) setRefreshError(refreshSummary(config.refresh?.sources ?? []));
      if (source) {
        const status = config.refresh?.sources.find((item) => item.id === source);
        if (status?.status === 'failed') setRefreshError((status.error || 'This source could not be fetched.') + ' Previously saved listings are preserved; this is not a fresh fetch.');
        else if (check.state === 'already_checked') setRefreshError('This source is cooling down. Previously saved listings are shown; try again after the retry time in source status.');
      }
      const filters = appliedFilters.current;
      const version = searchVersion.current;
      const fresh = await api('search', {
        body: { ...filters, includeCommute: config.commuteConfigured === true }, token: activeToken, signal,
      });
      if (!signal?.aborted && searchVersion.current === version && appliedFilters.current === filters) {
        searchVersion.current += 1;
        setResult(fresh);
      }
    } catch (failure) {
      if (failure.refreshRetryAt) { setRefreshClock(Date.now()); setRefreshRetryAt(failure.refreshRetryAt); }
      if (!signal?.aborted) setRefreshError(failure.message || 'The listing sources could not be checked.');
    } finally {
      if (checking.current === signal) {
        checking.current = null;
        if (!signal.aborted) setRefreshing(false);
      }
    }
  }, [activeToken, updateConfig]);

  useEffect(() => {
    if (API_ORIGIN === null) return;
    const controller = new AbortController();
    sourceSession.current = controller.signal;
    setRefreshing(false);
    api('config', { token: activeToken, signal: controller.signal }).then((config) => {
      if (controller.signal.aborted) return;
      setServerState('ready');
      updateConfig(config);
      const version = searchVersion.current;
      if (!submitted.current) {
        api('search', { body: { ...SEARCH_DEFAULTS, includeCommute: config.commuteConfigured === true }, token: activeToken, signal: controller.signal })
          .then((fresh) => {
            if (!submitted.current && !controller.signal.aborted && searchVersion.current === version) setResult(fresh);
          })
          .catch((failure) => { if (!controller.signal.aborted) setError(failure.message || 'Saved inventory could not be loaded. Please try again.'); });
      }
      // Opening Search reads the saved inventory only. Refresh is explicitly user initiated.

    }).catch((failure) => {
      if (controller.signal.aborted) return;
      setServerState(failure.status === 401 ? 'locked' : 'offline');
      if (failure.status === 401) setExpanded('more');
    });
    return () => controller.abort();
  }, [activeToken, checkSources, updateConfig]);

  const lastCheckedAt = refresh?.lastCheckedAt;
  const loadMarket = useCallback((region, grouping, signal) =>
    api('market?' + new URLSearchParams({ region, grouping }), { token: activeToken, signal }),
  [activeToken, lastCheckedAt]);

  const loadHousing = useCallback((signal) => api('housing', { token: activeToken, signal }), [activeToken, lastCheckedAt]);

  async function submit(nextDraft: typeof draft | typeof applied = draft) {
    if (busy) return;
    submitted.current = true;
    searchVersion.current += 1;
    setError('');
    setBusy(true);
    try {
      const filters = parseFilters({ ...nextDraft, liveOnly: true, includeCommute: commuteConfigured });
      if (needsCommute(filters) && serverState !== 'ready') {
        setExpanded('commute');
        throw new Error('Commute estimates need the online search server. Try again when it is available.');
      }
      if (needsCommute(filters) && !commuteConfigured) {
        setExpanded('commute');
        throw new Error('Automatic commute estimates are currently unavailable.');
      }
      const searchResult = serverState === 'ready' ?
        await api('search', { body: filters, token: activeToken }) : localSearch([], filters, localWorkplace(filters), 'live');
      appliedFilters.current = filters;
      setApplied(filters);
      setResult(searchResult);
      setScope('market');
      setAdding(false);
      navigateTab('results');
      setExpanded('');
    } catch (failure) {
      if (failure.commuteError) setExpanded('commute');
      setError(failure.message || 'Search could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function fetchPage(offset: number) {
    if (busy || serverState !== 'ready') return;
    const version = ++searchVersion.current;
    const filters = appliedFilters.current;
    setBusy(true); setError('');
    try {
      const page = await api('search', { body: { ...filters, offset }, token: activeToken });
      if (searchVersion.current === version && appliedFilters.current === filters) setResult(page);
    } catch (failure) { setError(failure.message || 'Could not load the next page.'); }
    finally { setBusy(false); }
  }

  function searchCompany(company) {
    const nextDraft = { ...formDefaults(), company, bedrooms: null, maxRent: '' };
    setDraft(nextDraft);
    submit(nextDraft);
  }

  function showMarket() {
    setScope('market');
    setAdding(false);
  }

  function selectSource(source) {
    if (busy) return;
    setDraft((current) => ({ ...current, source }));
    submit({ ...applied, source });
  }

  function selectSort(sort) {
    if (busy || sort === applied.sort) return;
    setDraft((current) => ({ ...current, sort }));
    submit({ ...applied, sort });
  }

  function saveListing(listing) {
    setSaved((current) => mergeListings([...current, { ...listing, buildingLinks: undefined }]));
  }

  function saveLink(listing, link) {
    saveListing({ ...listing, sources: mergeSourceLinks(listing.sources, [link]) });
  }

  function showSaved() {
    setScope('saved');
    navigateTab('saved');
  }

  const toggleFilter = (panel) => { setDraft({ ...formDefaults(), ...applied, maxRent: applied.maxRent == null ? '' : String(applied.maxRent), maxTransitMinutes: applied.maxTransitMinutes == null ? '' : String(applied.maxTransitMinutes), maxDrivingMinutes: applied.maxDrivingMinutes == null ? '' : String(applied.maxDrivingMinutes) }); setExpanded((current) => current === panel ? '' : panel); };
  const displayed = scope === 'saved' ? savedResults : result;
  const points = displayed.mapPoints ?? EMPTY_POINTS;
  const split = WEB_MAP && wide && mapView;
  const listVisible = !WEB_MAP || !mapView || wide;
  const marketArea = REGIONS[applied.region].label;
  const commuteLabel = [
    applied.maxTransitMinutes != null && `Transit ≤ ${applied.maxTransitMinutes} min`,
    applied.maxDrivingMinutes != null && `Drive ≤ ${applied.maxDrivingMinutes} min`,
  ].filter(Boolean).join(' · ') || 'Commute';

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content" {...{ backgroundColor: colors.navy }} />
    <View style={styles.topBar}>
      <View style={styles.brand}><View style={styles.brandMark}><Text style={styles.brandLetter}>A</Text></View>
        <Text style={styles.brandText}>Apartment Search</Text></View>
      <Text style={styles.topLabel}>NYC METRO</Text>
    </View>
    {(tab === 'results' || tab === 'saved') && <View style={mobileStyles.searchBar}>
      <View style={mobileStyles.summary}><Text numberOfLines={1} style={styles.fieldLabel}>{tab === 'saved' ? 'Your saved apartments' : marketArea}</Text>
        <Text numberOfLines={1} style={styles.smallMuted}>{tab === 'saved' ? 'All apartment sizes · Any price' : bedroomLabel(applied.bedrooms) + ' · ' + (applied.maxRent == null ? 'Any price' : 'Up to ' + formatRent(applied.maxRent))}</Text></View>
      {tab === 'results' && <Button secondary onPress={() => toggleFilter('more')}>Filters</Button>}
      {WEB_MAP && <Button secondary onPress={() => setMapView(!mapView)}>{mapView ? 'List' : 'Map'}</Button>}
    </View>}
    <Modal visible={Boolean(expanded)} transparent animationType="slide" onRequestClose={() => setExpanded('')}>
      <View style={mobileStyles.overlay}><View style={[mobileStyles.sheet, wide && mobileStyles.wideSheet]} accessibilityViewIsModal>
        <View style={mobileStyles.sheetHeader}><Text accessibilityRole="header" style={styles.panelTitle}>Search filters</Text><Button secondary onPress={() => setExpanded('')}>Cancel</Button></View>
        <ScrollView keyboardShouldPersistTaps="handled">
          {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <Filters panel="more" draft={draft} setDraft={setDraft} submit={() => submit()} busy={busy} serverState={serverState} token={token} setToken={setToken} commuteConfigured={commuteConfigured} connect={() => setActiveToken(token.trim())} />
          <WebsiteFilter result={result} applied={draft} onSelect={(source) => setDraft((current) => ({ ...current, source }))} onError={setError} />
        </ScrollView>
      </View></View>
    </Modal>
    <ScrollView ref={scrollRef} testID="main-scroll" onScroll={(event) => { scrollPositions.current[tab] = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={100} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={styles.shell}>
        <View style={styles.results}>
            {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {(tab === 'results' || tab === 'saved') && <>
              {tab === 'saved' && <SavedComparison listings={saved} />}
              {tab === 'saved' && <TourPlanner listings={saved} />}
              {tab === 'results' && <SavedSearches filters={applied} disabled={busy} apply={filters => { const next = { ...filters, includeMap: WEB_MAP }; setDraft({ ...formDefaults(), ...next }); submit(next); }} check={filters => { if (serverState !== 'ready') return Promise.reject(new Error('Connect to the inventory server before checking a saved search.')); return api('search-check', { body: filters, token: activeToken }); }} />}
              {tab === 'results' && <ObservedChanges listings={result.matches} />}
              {tab === 'results' && <Pressable accessibilityRole="button" accessibilityLabel="View source freshness and coverage" onPress={() => navigateTab('sources')}>
                <Text style={mobileStyles.freshness}>{refreshing ? 'Refreshing sources…' : failedSources.length ? 'Partial coverage · Some sources unavailable' : refresh?.lastCheckedAt ? 'Saved results · ' + CHECK_TIME.format(new Date(refresh.lastCheckedAt)) : 'Saved results · Not yet refreshed'} · Details</Text>
              </Pressable>}
              <View style={[styles.resultLayout, split && styles.resultLayoutWide]}>
                {listVisible && <View style={styles.results}>
                  <Results onCheckBuilding={serverState === 'ready' ? listing => api('building-report', { token: activeToken, body: { address: listing.address, city: listing.city, county: listing.county, state: listing.state, zip: listing.zip } }) : undefined} visible={visible} setVisible={setVisible} result={displayed} applied={applied} sort={scope === 'saved' ? SAVED_FILTERS.sort : applied.sort} onSort={selectSort}
                    onPage={fetchPage} paging={busy}
                    openCommute={() => setExpanded('commute')}
                    commuteConfigured={commuteConfigured}
                    checkingInventory={refreshing || serverState === 'checking' || busy}
                    columns={wide} savedByKey={savedByKey}
                    showMarkets={() => navigateTab('marketplaces')} onSave={saveListing} onSaveLink={saveLink}
                    onRemove={(listing) => setSaved((current) => current.filter((item) => listingKey(item) !== listingKey(listing)))}
                    onError={setError} />
                </View>}
                {WEB_MAP && mapView && <View style={[styles.mapPanel, split && styles.mapPanelWide]}>
                  <ListingMap points={points} total={displayed.total} visible />
                </View>}
              </View>
            </>}
            {tab === 'more' && <View style={styles.filters}><Text accessibilityRole="header" style={styles.panelTitle}>More</Text>
              {[['sources', 'Sources & sync'], ['chart', 'Rent chart'], ['marketplaces', 'Rental platforms'], ['affordable', 'Affordable housing']].map(([key, label]) => <Button key={key} secondary onPress={() => navigateTab(key)}>{label}</Button>)}
            </View>}
            {tab === 'chart' && <RentChart initialRegion={applied.region} saved={saved} showSaved={showSaved} onError={setError}
              loadMarket={serverState === 'ready' ? loadMarket : undefined} />}
            {tab === 'sources' && <>
              <Text accessibilityRole="header" style={styles.panelTitle}>Sources & sync</Text>
              {refreshError !== '' && <Text accessibilityRole="alert" style={styles.noticeLine}>{refreshError}</Text>}
              <View style={styles.chipRow}><Button secondary onPress={() => setAdding('single')}>+ Add listing</Button><Button secondary onPress={() => setAdding('import')}>Import CSV</Button></View>
              {adding === 'single' && <AddListing initialRegion={applied.region}
                onSave={(listing) => { saveListing(listing); setAdding(false); }}
                onCancel={() => setAdding(false)}
                geocode={serverState === 'ready' ? (address) => api('geocode', { body: { address }, token: activeToken }) : null} />}
              {adding === 'import' && <ImportListings
                onImport={(listings) => {
                  if (listings.some((listing) => !matchesRegion(listing, NYC_SEARCH_DEFAULT))) {
                    throw new Error('Import listings with Manhattan or Brooklyn ZIP codes.');
                  }
                  setSaved((current) => mergeListings([...listings, ...current]));
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)} />}
              <SourcesPage catalog={sourceCatalog} refresh={refresh} refreshing={refreshing} cooldownSeconds={cooldownSeconds} onResync={(id) => checkSources(false, id ?? null)} />
            </>}
            {tab === 'marketplaces' && <Marketplaces filters={applied} sources={result.sources}
              configuredSources={configuredSources} companies={companies} onCompany={searchCompany} refresh={refresh} refreshing={refreshing} cooldownSeconds={cooldownSeconds}
              onRefresh={() => checkSources()} onError={setError} />}
            {tab === 'affordable' && <AffordableHousing region={applied.region}
              loadHousing={serverState === 'ready' ? loadHousing : undefined} onError={setError} />}
        </View>
        <View style={styles.footer}>
          <Text style={styles.smallMuted}>Apartment Search · New York, New Jersey and Connecticut</Text>
        </View>
      </View>
    </ScrollView>
    <View style={mobileStyles.bottomNav}>
      {[['results', 'Search'], ['saved', `Saved (${savedResults.total})`], ['more', 'More']].map(([key, label]) => {
        const selected = key === 'more' ? !['results', 'saved'].includes(tab) : tab === key;
        return <Pressable key={key} accessibilityRole="tab" aria-selected={selected} accessibilityState={{ selected }} style={[mobileStyles.navItem, selected && mobileStyles.navSelected]} onPress={() => navigateTab(key)}><Text style={styles.tabLabel}>{label}</Text></Pressable>;
      })}
    </View>
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><ApartmentSearch /></SafeAreaProvider>;
}


