import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking, Platform, Pressable, ScrollView, StatusBar, Text, View, useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NYC_COMPANIES } from './src/companies.mjs';
import { MARKETS, REGIONS, WORKPLACES } from './src/regions.mjs';
import { marketplaceLinks } from './src/marketplaces.mjs';
import {
  DEFAULT_FILTERS, bedroomLabel, compareResults, directionsLink, formatRent, parseFilters,
} from './src/search.mjs';
import { colors, styles } from './src/styles.js';
import { formatSnapshotMonth, localSearch, snapshotSearch, SNAPSHOT_MONTH, SNAPSHOT_SOURCE } from './src/market.mjs';
import { listingKey, mergeListings, mergeSourceLinks } from './src/listings.mjs';
import { Button, Chip, Field, Link, SectionTitle } from './src/ui.jsx';
import { encodeSourceImport, pullPublicSources } from './src/pull-sources.mjs';
import { AffordableHousing } from './src/AffordableHousing.jsx';
import { AddListing } from './src/AddListing.jsx';
import { ListingSources } from './src/ListingSources.jsx';
import { RentChart } from './src/RentChart.jsx';

const API_ORIGIN = Platform.OS === 'web' ? '' :
  (process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || null);
const BEDROOMS = [null, 0, 1, 2, 3, 4];
const PAGE_SIZE = 12;
const SAVED_KEY = 'apartment-search:saved-listings:v1';
const SAVED_FILTERS = { ...DEFAULT_FILTERS, bedrooms: null, maxRent: null };
const CHECK_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

const formDefaults = () => ({
  ...DEFAULT_FILTERS,
  maxRent: String(DEFAULT_FILTERS.maxRent),
  maxMiles: '',
});

async function api(path, { body, token, signal } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_ORIGIN}/api/${path}`, {
    method: body ? 'POST' : 'GET', headers, signal,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Could not reach the apartment search server.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function Hero({ wide }) {
  return <View style={[styles.hero, wide && styles.heroWide]}>
    <View style={styles.heroCopy}>
      <View style={styles.heroEyebrow}><View style={styles.liveDot} /><Text style={styles.heroEyebrowText}>NEW YORK METRO AREA</Text></View>
      <Text accessibilityRole="header" style={[styles.heroTitle, wide && styles.heroTitleWide]}>Find a rent{wide ? '\n' : ' '}that fits.</Text>
      <Text style={styles.heroDescription}>Compare apartment prices and the trip to work, from the five boroughs to the commuter rail lines.</Text>
    </View>
    {wide && <View style={styles.network} aria-hidden accessibilityElementsHidden>
      {[
        ['NYC SUBWAY', '#c6f36c', '44%'],
        ['PATH · NJ TRANSIT', '#ff9c71', '21%'],
        ['LONG ISLAND RAIL ROAD', '#8bc7fa', '70%'],
        ['METRO-NORTH', '#d9b8ff', '34%'],
      ].map(([label, color, stop]) => <View key={label} style={styles.networkRow}>
        <Text style={[styles.networkLabel, { color }]}>{label}</Text>
        <View style={[styles.networkLine, { backgroundColor: color }]}>
          <View style={[styles.networkStop, { left: stop, borderColor: color }]} />
        </View>
      </View>)}
    </View>}
  </View>;
}

function Filters({ draft, setDraft, submit, busy, serverState, token, setToken, connect }) {
  const set = (field) => (value) => setDraft((previous) => ({ ...previous, [field]: value }));

  return <View style={styles.filters}>
    <SectionTitle index="01">Apartment</SectionTitle>
    <Text style={styles.fieldLabel}>Bedrooms</Text>
    <View style={styles.chipRow}>
      {BEDROOMS.map((beds) => <Chip key={String(beds)} selected={draft.bedrooms === beds}
        onPress={() => set('bedrooms')(beds)}>{beds === null ? 'Any' : beds === 0 ? 'Studio' : `${beds} BR`}</Chip>)}
    </View>
    <Text style={styles.fieldLabel}>Area</Text>
    <View style={styles.chipRow}>
      {Object.entries(REGIONS).map(([key, region]) => <Chip key={key} selected={draft.region === key}
        onPress={() => set('region')(key)}>{region.label}</Chip>)}
    </View>
    <Field label="ZIP code (optional)" placeholder="Any ZIP in this area" value={draft.zip}
      onChangeText={set('zip')} keyboardType="number-pad" maxLength={5} />
    <Field label="Max rent per month ($)" placeholder="Any rent" value={draft.maxRent}
      onChangeText={set('maxRent')} keyboardType="number-pad" maxLength={6} />

    <Field label="Listing company (optional)" placeholder="Compass, SERHANT., Corcoran…" value={draft.company}
      onChangeText={set('company')} maxLength={80} />

    <View style={styles.divider} />
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
    <Field label="Max straight-line distance (mi)" placeholder="Any distance" value={draft.maxMiles}
      onChangeText={set('maxMiles')} keyboardType="decimal-pad" maxLength={6} />
    <Text style={styles.smallMuted}>Open transit directions from any listing to check travel time.</Text>
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

function Listing({ listing, number, workplace, onSave, onSaveLink, onRemove, onError, saved }) {
  const { region, address, unit, city, state, zip, rent, bedrooms, miles, neighborhood } = listing;
  const regionInfo = REGIONS[region];
  const title = unit ? `${address}, ${unit.startsWith('#') ? unit : 'Unit ' + unit}` : address;
  const subtitle = [neighborhood === city ? '' : neighborhood, `${city}, ${state} ${zip}`].filter(Boolean).join(' · ');
  const observation = listing.kind === 'snapshot' ? `First listed ${listing.seenAt}` :
    listing.kind === 'saved' ? 'Saved listing' : listing.sources.find(({ kind }) => kind === 'feed')?.name + ' · Checked live';

  return <View style={styles.listing}>
    <View style={styles.listingTop}>
      <View style={styles.listingContent}>
        <View style={styles.listingKicker}>
          <Text style={styles.rank}>{String(number).padStart(2, '0')}</Text>
          <View style={[styles.regionDot, { backgroundColor: regionInfo.color }]} />
          <Text style={[styles.regionLabel, { color: regionInfo.color }]}>{regionInfo.label}</Text>
        </View>
        <Text accessibilityRole="header" style={styles.listingTitle}>{title}</Text>
        <Text style={styles.smallMuted}>{subtitle}</Text>
        {listing.company ? <Text style={styles.smallMuted}>{listing.kind === 'feed' && listing.sources.some(({ kind }) => kind === 'snapshot') ?
          'Snapshot advertiser' : 'Listed by'} {listing.company}</Text> : null}
      </View>
      <View style={styles.priceBlock}>
        <Text style={styles.price}>{formatRent(rent)}</Text>
        <Text style={styles.smallMuted}>asking rent / mo</Text>
      </View>
    </View>
    <View style={styles.cardStats}>
      <Text style={styles.cardStat}>{bedroomLabel(bedrooms)}</Text>
      <Text style={styles.cardStat}>{miles === null ? 'Distance unavailable' : `${miles.toFixed(1)} mi straight-line`}</Text>
    </View>
    <View style={styles.cardActions}>
      <Text style={styles.smallMuted}>{observation}</Text>
      <View style={styles.actionLinks}>
        <Link label="Transit directions" url={directionsLink(listing, workplace)} onError={onError} />
        <Link label="Driving from workplace" url={directionsLink(listing, workplace, 'driving')} onError={onError} />
        {onRemove ? <Pressable accessibilityRole="button" onPress={() => onRemove(listing)} style={styles.link}>
          <Text style={styles.linkText}>Remove saved</Text>
        </Pressable> : <Pressable accessibilityRole="button" accessibilityState={{ disabled: saved }}
          disabled={saved} onPress={() => onSave(listing)} style={styles.link}>
          <Text style={styles.linkText}>{saved ? 'Saved' : 'Save apartment'}</Text>
        </Pressable>}
      </View>
    </View>
    <ListingSources listing={listing} onSaveLink={onSaveLink} onError={onError} />
  </View>;
}

function Marketplaces({ filters, sources, configuredSources, companies, onCompany, refresh, refreshing, onRefresh, onError }) {
  const markets = MARKETS.filter((market) => filters.region === 'all' || market.region === filters.region);
  const [marketLabel, setMarketLabel] = useState('');
  const market = markets.find((item) => item.label === marketLabel) ??
    markets.find((item) => item.zip === filters.zip) ?? markets[0];
  const searchFeeds = new Set(sources.filter(({ status }) => status === 'searched').map(({ id }) => id));
  const configured = new Set(configuredSources.map(({ id }) => id));
  const unavailable = new Set(sources.filter(({ status }) => status === 'unavailable').map(({ id }) => id));

  return <View style={styles.marketplacePanel}>
    <Text accessibilityRole="header" style={styles.panelTitle}>Browse rental platforms</Text>
    <Text style={styles.bodyText}>StreetEasy listings are available through FirstMover’s {formatSnapshotMonth(refresh?.sources.find(({ id }) => id === 'firstmover')?.month)} export. Marketplace search links work without API fees and carry filters where supported.</Text>
    <View style={styles.chartSource}>
      <Text style={styles.fieldLabel}>{configured.size === 0 ? 'Live marketplace imports: none' : `Authorized free feeds: ${configuredSources.map(({ name }) => name).join(', ')}`}</Text>
      <Link label="FirstMover Open Data" url={SNAPSHOT_SOURCE} onError={onError} />
      <Text style={styles.smallMuted}>Settled.nyc · source access unverified.</Text>
      {refresh && <Button secondary onPress={onRefresh} disabled={refreshing}>
        {refreshing ? 'Checking sources…' : 'Check public exports now'}
      </Button>}
      <Text style={styles.smallMuted}>The hourly job also checks the Openigloo live sample.</Text>
      {refresh?.lastCheckedAt && <>
        <Text style={styles.fieldLabel}>Last source check · {CHECK_TIME.format(new Date(refresh.lastCheckedAt))}</Text>
        {refresh.sources.map(({ id, name, status, updatedAt }) => <Text key={id} style={styles.smallMuted}>
          {name} · {status === 'updated' ? 'New data imported' : status === 'current' ? 'Latest release already loaded' :
            updatedAt ? 'Refresh failed · using last successful import' : 'Refresh failed'}
        </Text>)}
      </>}
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
        <Pressable key={id} accessibilityRole="link" accessibilityLabel={`Open ${name}, ${detail}`}
          onPress={() => Linking.openURL(url).catch(() => onError(`Could not open ${name}.`))}
          style={({ pressed }) => [styles.marketCard, pressed && styles.pressed]}>
          <View style={styles.marketInfo}>
            <Text style={styles.marketName}>{name}</Text>
            <Text style={styles.smallMuted}>{detail}</Text>
          </View>
          <Text style={styles.marketArrow}>↗</Text>
          <Text style={styles.marketType}>{searchFeeds.has(id) ? (id === 'openigloo' ? 'LIMITED LIVE SAMPLE' : 'FREE LIVE FEED') : unavailable.has(id) ? 'FEED UNAVAILABLE' :
            configured.has(id) ? 'FREE FEED CONFIGURED' : id === 'streeteasy' ? 'MONTHLY SNAPSHOT' : 'BROWSE ONLY'}</Text>
        </Pressable>)}
    </View>
    <Text accessibilityRole="header" style={styles.panelTitle}>NYC brokerages and apartment companies</Text>
    <Text style={styles.bodyText}>The counts show listings attributed to each company in the dated StreetEasy export. Select a company to search those apartments here.</Text>
    <View style={styles.marketGrid}>
      {NYC_COMPANIES.map(({ id, name, url, type }) => <View key={id} style={[styles.chartCard, { flexGrow: 1, flexBasis: '46%', minWidth: 150 }]}>
        <Text style={styles.marketName}>{name}</Text>
        <Text style={styles.smallMuted}>{type} · {companies[id] ? companies[id].toLocaleString('en-US') + ' in the snapshot' : 'Website link'}</Text>
        {companies[id] > 0 && <Button secondary onPress={() => onCompany(name)}>Search in Apartment Search</Button>}
        <Link label="Company website" url={url} onError={onError} />
      </View>)}
    </View>
  </View>;
}

function Results({ result, applied, savedByKey, showMarkets, onSave, onSaveLink, onRemove, onError }) {
  const [sort, setSort] = useState('rent');
  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => { setVisible(PAGE_SIZE); setSort('rent'); }, [result]);
  const matches = [...result.matches].sort((first, second) => compareResults(first, second, sort));
  const savedView = result.mode === 'saved';
  const summary = savedView ? 'Saved on this device · All apartment sizes' : [
    REGIONS[applied.region].label, bedroomLabel(applied.bedrooms), applied.zip, applied.company,
    applied.maxRent === null ? null : `Up to ${formatRent(applied.maxRent)}`,
    applied.maxMiles === null ? null : `Within ${applied.maxMiles} mi`,
  ].filter(Boolean).join(' · ');

  return <>
    {(result.mode === 'snapshot' || result.mode === 'mixed') && <View style={styles.demoNotice}>
      <View style={styles.demoMark}><Text style={styles.demoMarkText}>i</Text></View>
      <View style={styles.noticeCopy}>
        <Text style={styles.noticeTitle}>{result.mode === 'mixed' ? 'Live sample and ' : ''}{formatSnapshotMonth(result.snapshotMonth)} listing snapshot</Text>
        <Text style={styles.bodyText}>Initial asking prices from FirstMover’s StreetEasy data. Check the linked marketplace for current prices and availability.</Text>
        <Pressable accessibilityRole="button" onPress={showMarkets}><Text style={styles.linkText}>Browse rental platforms →</Text></Pressable>
      </View>
    </View>}
    <View style={styles.resultHeading}>
      <View style={styles.headingCopy}>
        <Text accessibilityRole="header" style={styles.panelTitle}>{result.total.toLocaleString('en-US')} {savedView ? 'saved' : 'matching'} {result.total === 1 ? 'apartment' : 'apartments'}</Text>
        <Text style={styles.smallMuted}>{summary}</Text>
        <Text style={styles.smallMuted}>To {result.workplace.label}</Text>
      </View>
      <View style={styles.chipRow}>
        <Chip selected={sort === 'rent'} onPress={() => setSort('rent')}>Lowest rent</Chip>
        <Chip selected={sort === 'distance'} onPress={() => setSort('distance')}>Closest</Chip>
      </View>
    </View>
    {result.notices.map((notice) => <Text key={notice} style={styles.noticeLine}>{notice}</Text>)}
    {matches.length === 0 && <View style={styles.empty}>
      <Text accessibilityRole="header" style={styles.panelTitle}>{savedView ? 'Your saved list is empty' : 'No matches'}</Text>
      <Text style={styles.bodyText}>{savedView ? 'Save a result or add an apartment you found on a rental platform.' :
        'Try another area or budget. Open a rental platform to check current listings in places the snapshot does not cover.'}</Text>
      <Button secondary onPress={showMarkets}>Browse rental platforms</Button>
    </View>}
    {matches.slice(0, visible).map((listing, index) => {
      const saved = savedByKey.get(listingKey(listing));
      const withLinks = saved ? { ...listing, sources: mergeSourceLinks(listing.sources, saved.sources) } : listing;
      return <Listing key={listing.id} listing={withLinks} number={index + 1} workplace={result.workplace}
        onSave={onSave} onSaveLink={onSaveLink} onError={onError} onRemove={savedView ? onRemove : null} saved={Boolean(saved)} />;
    })}
    {visible < matches.length && <Button secondary onPress={() => setVisible(visible + PAGE_SIZE)}>
      Show more ({Math.min(visible, matches.length)} of {matches.length})
    </Button>}
  </>;
}

function ApartmentSearch() {
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  const [draft, setDraft] = useState(formDefaults);
  const [applied, setApplied] = useState(DEFAULT_FILTERS);
  const [result, setResult] = useState(() => snapshotSearch(DEFAULT_FILTERS));
  const [saved, setSaved] = useState([]);
  const [storageReady, setStorageReady] = useState(false);
  const [serverState, setServerState] = useState(API_ORIGIN === null ? 'offline' : 'checking');
  const [configuredSources, setConfiguredSources] = useState([]);
  const [companies, setCompanies] = useState({});
  const [refresh, setRefresh] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const submitted = useRef(false);
  const searchVersion = useRef(0);
  const [token, setToken] = useState('');
  const [activeToken, setActiveToken] = useState('');
  const [tab, setTab] = useState('results');
  const [scope, setScope] = useState('market');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

  useEffect(() => {
    if (API_ORIGIN === null) return;
    const controller = new AbortController();
    api('config', { token: activeToken, signal: controller.signal }).then((config) => {
      setServerState('ready');
      setConfiguredSources(config.sources);
      setCompanies(config.companies ?? {});
      setRefresh(config.refresh ?? null);
      if (!submitted.current && (config.snapshotMonth !== SNAPSHOT_MONTH || config.mode === 'live' ||
          config.refresh?.sources.some(({ id, updatedAt }) => id === 'firstmover' && updatedAt))) {
        api('search', { body: DEFAULT_FILTERS, token: activeToken, signal: controller.signal })
          .then((fresh) => { if (!submitted.current && !controller.signal.aborted) setResult(fresh); })
          .catch(() => {});
      }
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      setServerState(failure.status === 401 ? 'locked' : 'offline');
      if (failure.status === 401) setExpanded(true);
    });
    return () => controller.abort();
  }, [activeToken]);

  useEffect(() => {
    if (tab !== 'marketplaces' || serverState !== 'ready') return;
    const controller = new AbortController();
    api('config', { token: activeToken, signal: controller.signal }).then((config) => {
      setConfiguredSources(config.sources);
      setCompanies(config.companies ?? {});
      setRefresh(config.refresh ?? null);
    }).catch(() => {});
    return () => controller.abort();
  }, [tab, serverState, activeToken]);

  const loadMarket = useCallback((region, grouping, signal) =>
    api('market?' + new URLSearchParams({ region, grouping }), { token: activeToken, signal }),
  [activeToken]);

  const loadHousing = useCallback((signal) => api('housing', { token: activeToken, signal }), [activeToken]);

  async function checkSources() {
    if (refreshing || busy) return;
    const version = searchVersion.current;
    setRefreshing(true);
    setError('');
    try {
      const plan = await api('refresh', { token: activeToken });
      if (!plan.ready) throw new Error('Hosted refresh storage is unavailable.');
      if (!plan.publicAlreadyChecked) {
        const imports = await pullPublicSources(plan);
        await api('refresh', { body: encodeSourceImport(imports), token: activeToken });
      }
      const fresh = await api('search', { body: applied, token: activeToken });
      if (searchVersion.current === version) setResult(fresh);
    } catch (failure) {
      setError(failure.message || 'The source check failed.');
    } finally {
      try {
        const config = await api('config', { token: activeToken });
        setRefresh(config.refresh ?? null);
      } catch {
        // The previous check remains visible when the server cannot be reached.
      }
      setRefreshing(false);
    }
  }

  async function submit(nextDraft = draft) {
    if (busy) return;
    submitted.current = true;
    searchVersion.current += 1;
    setError('');
    setBusy(true);
    try {
      const filters = parseFilters(nextDraft);
      const searchResult = serverState === 'ready' ?
        await api('search', { body: filters, token: activeToken }) : snapshotSearch(filters);
      setApplied(filters);
      setResult(searchResult);
      setScope('market');
      setAdding(false);
      setTab('results');
      if (!wide) setExpanded(false);
    } catch (failure) {
      setError(failure.message || 'Search could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  function searchCompany(company) {
    const nextDraft = { ...formDefaults(), company, bedrooms: null, maxRent: '' };
    setDraft(nextDraft);
    submit(nextDraft);
  }

  function selectInventory(liveOnly) {
    setScope('market');
    setAdding(false);
    if (applied.liveOnly === liveOnly) return;
    const nextDraft = { ...draft, liveOnly };
    setDraft(nextDraft);
    submit(nextDraft);
  }

  function saveListing(listing) {
    setSaved((current) => mergeListings([...current, { ...listing, buildingLinks: undefined }]));
  }

  function saveLink(listing, link) {
    saveListing({ ...listing, sources: mergeSourceLinks(listing.sources, [link]) });
  }

  function showSaved() {
    setScope('saved');
    setTab('results');
  }

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={styles.shell}>
        <View style={styles.topBar}>
          <View style={styles.brand}><View style={styles.brandMark}><Text style={styles.brandLetter}>A</Text></View>
            <Text style={styles.brandText}>Apartment Search</Text></View>
          <Text style={styles.topLabel}>NYC METRO</Text>
        </View>
        <Hero wide={wide} />
        <View style={[styles.workspace, wide && styles.workspaceWide]}>
          <View style={[styles.sidebar, wide && styles.sidebarWide]}>
            {!wide && <Button secondary onPress={() => setExpanded(!expanded)}>
              {expanded ? 'Hide filters ↑' : 'Edit search filters ↓'}
            </Button>}
            {(wide || expanded) && <Filters draft={draft} setDraft={setDraft} submit={() => submit()}
              busy={busy} serverState={serverState} token={token} setToken={setToken}
              connect={() => setActiveToken(token.trim())} />}
          </View>
          <View style={styles.results}>
            <View style={styles.tabs}>
              {[['results', 'Results'], ['chart', 'Rent chart'], ['marketplaces', 'Platforms'], ['affordable', 'Affordable']].map(([key, label]) =>
                <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
                  style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)}>
                  <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>{label}</Text>
                </Pressable>)}
            </View>
            {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {tab === 'results' && <>
              <View style={styles.scopeRow}>
                <View style={styles.chipRow}>
                  <Chip selected={scope === 'market' && !applied.liveOnly} onPress={() => selectInventory(false)}>All results</Chip>
                  <Chip selected={scope === 'market' && applied.liveOnly} onPress={() => selectInventory(true)}>Live only</Chip>
                  <Chip selected={scope === 'saved'} onPress={showSaved}>Saved ({saved.length})</Chip>
                </View>
                {!adding && <Button secondary onPress={() => { setAdding(true); showSaved(); }}>+ Add listing</Button>}
              </View>
              {adding && <AddListing initialRegion={applied.region}
                onSave={(listing) => { saveListing(listing); setAdding(false); }}
                onCancel={() => setAdding(false)}
                geocode={serverState === 'ready' ? (address) => api('geocode', { body: { address }, token: activeToken }) : null} />}
              <Results result={scope === 'saved' ? savedResults : result} applied={applied} savedByKey={savedByKey}
                showMarkets={() => setTab('marketplaces')} onSave={saveListing} onSaveLink={saveLink}
                onRemove={(listing) => setSaved((current) => current.filter((item) => listingKey(item) !== listingKey(listing)))}
                onError={setError} />
            </>}
            {tab === 'chart' && <RentChart initialRegion={applied.region} saved={saved} showSaved={showSaved} onError={setError}
              loadMarket={serverState === 'ready' ? loadMarket : undefined} />}
            {tab === 'marketplaces' && <Marketplaces filters={applied} sources={result.sources}
              configuredSources={configuredSources} companies={companies} onCompany={searchCompany} refresh={refresh} refreshing={refreshing} onRefresh={checkSources} onError={setError} />}
            {tab === 'affordable' && <AffordableHousing loadHousing={serverState === 'ready' ? loadHousing : undefined} onError={setError} />}
          </View>
        </View>
        <View style={styles.footer}>
          <Text style={styles.smallMuted}>Apartment Search · New York, New Jersey, Connecticut and eastern Pennsylvania</Text>
          <Text style={styles.smallMuted}>Distances are straight-line miles. Open driving directions to check travel time.</Text>
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><ApartmentSearch /></SafeAreaProvider>;
}
