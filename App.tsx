import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform, Pressable, ScrollView, StatusBar, Text, View, useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NYC_COMPANIES } from './src/companies.ts';
import { NYC_SEARCH_AREAS, NYC_SEARCH_DEFAULT, NYC_SEARCH_MARKETS, REGIONS, WORKPLACES, marketsForSearch, matchesRegion, searchBorough } from './src/regions.ts';
import { MARKETPLACE_NAMES, marketplaceLinks } from './src/marketplaces.ts';
import {
  DEFAULT_FILTERS, RESULT_SORTS, bedroomLabel, directionsLink, formatRent, localWorkplace, needsCommute, parseFilters,
} from './src/search.ts';
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
import { ListingSources } from './src/ListingSources.tsx';
import { RentChart } from './src/RentChart.tsx';

const API_ORIGIN = Platform.OS === 'web' ? '' :
  (process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || null);
const WEB_MAP = Platform.OS === 'web';
const SEARCH_DEFAULTS = { ...DEFAULT_FILTERS, region: 'all', bedrooms: null, maxRent: null, source: '', includeMap: WEB_MAP, liveOnly: true };
const BEDROOMS = [null, 0, 1, 2, 3, 4];
const PAGE_SIZE = 12;
const EMPTY_POINTS = [];
const SAVED_KEY = 'apartment-search:saved-listings:v1';
const SESSION_REFRESH_KEY = 'apartment-search:session-refresh';
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

function Listing({ listing, selectedSource, workplace, commute, onSave, onSaveLink, onRemove, onError, saved }) {
  const { region, address, unit, city, state, zip, rent, bedrooms, transitSeconds, drivingSeconds, neighborhood } = listing;
  const regionInfo = REGIONS[searchBorough(listing) ?? region];
  const title = unit ? `${address}, ${unit.startsWith('#') ? unit : 'Unit ' + unit}` : address;
  const subtitle = [neighborhood === city ? '' : neighborhood, `${city}, ${state} ${zip}`].filter(Boolean).join(' · ');
  const feed = listing.sources.find(({ kind }) => kind === 'feed');
  const [original] = orderedListingLinks(listing.sources, selectedSource);
  const historical = ['snapshot', 'cached'].includes(original?.kind);
  const checkedAt = listing.checkedAt ?? listing.seenAt;
  const checked = Number.isFinite(Date.parse(checkedAt)) ?
    'Checked ' + CHECK_TIME.format(new Date(checkedAt)) : 'Previous check';
  const observation = listing.kind === 'snapshot' ? `First listed ${listing.seenAt}` :
    listing.kind === 'saved' ? 'Saved listing' :
    listing.kind === 'cached' ? checked + ' · Last saved result' :
      (feed?.name ?? 'Live source') + ' · ' + checked;

  return <View style={styles.rentalCard}>
    {original && <ExternalLink url={original.url} onError={onError} style={styles.listingMedia}
      accessibilityLabel={'Open photos and details for ' + title + ' on ' + original.name}>
      <Text style={styles.mediaSource}>{original.name}</Text>
      <Text style={styles.mediaLabel}>{historical ? 'View original ad ↗' : 'Photos and details ↗'}</Text>
    </ExternalLink>}
    <View style={styles.rentalCardBody}>
    <View style={styles.listingTop}>
      <View style={styles.listingContent}>
        <View style={styles.listingKicker}>
          <View style={[styles.regionDot, { backgroundColor: regionInfo.color }]} />
          <Text style={[styles.regionLabel, { color: regionInfo.color }]}>{regionInfo.label}</Text>
        </View>
        {original ? <ExternalLink url={original.url} onError={onError} accessibilityLabel={title + ' on ' + original.name}>
          <Text style={styles.listingAddress}>{title}</Text>
        </ExternalLink> : <Text accessibilityRole="header" style={styles.listingTitle}>{title}</Text>}
        <Text style={styles.smallMuted}>{subtitle}</Text>
        {listing.company ? <Text style={styles.smallMuted}>{listing.kind === 'feed' &&
          (listing.companyFromSnapshot || listing.sources.some(({ kind }) => kind === 'snapshot')) ?
          'Snapshot advertiser' : 'Listed by'} {listing.company}</Text> : null}
      </View>
      <View style={styles.priceBlock}>
        <Text style={styles.price}>{formatRent(rent)}</Text>
        <Text style={styles.smallMuted}>{listing.kind === 'snapshot' ? 'recorded rent / mo' :
          listing.priceIncludesFees ? 'total price / mo' : 'asking rent / mo'}</Text>
      </View>
    </View>
    <View style={styles.cardStats}>
      <Text style={styles.cardStat}>{bedroomLabel(bedrooms)}</Text>
      {[...new Set<string>(listing.sources.filter(({ url }) => url).map(({ name }) => name))].slice(0, 4).map((name) =>
        <Text key={name} style={styles.sourceBadge}>{name}</Text>)}
      {commute && <>
        <Text style={styles.cardStat}>{transitSeconds == null ? 'Transit unavailable' : `${Math.ceil(transitSeconds / 60)} min transit`}</Text>
        <Text style={styles.cardStat}>{drivingSeconds == null ? 'Driving unavailable' : `${Math.ceil(drivingSeconds / 60)} min drive`}</Text>
      </>}
    </View>
    <View style={styles.cardActions}>
      <Text style={styles.smallMuted}>{observation}</Text>
      <View style={styles.cardLinks}>
        {original && <Link label={listingLinkLabel(original)}
          url={original.url} onError={onError} />}
        <Link label="Transit directions" url={directionsLink(listing, workplace)} onError={onError} />
        <Link label="Driving directions" url={directionsLink(listing, workplace, 'driving')} onError={onError} />
        {onRemove ? <Pressable accessibilityRole="button" onPress={() => onRemove(listing)} style={styles.link}>
          <Text style={styles.linkText}>Remove saved</Text>
        </Pressable> : <Pressable accessibilityRole="button" accessibilityState={{ disabled: saved }}
          disabled={saved} onPress={() => onSave(listing)} style={styles.link}>
          <Text style={styles.linkText}>{saved ? 'Saved' : 'Save apartment'}</Text>
        </Pressable>}
      </View>
    </View>
    <ListingSources listing={listing} onSaveLink={onSaveLink} onError={onError} />
    </View>
  </View>;
}

function sourceCheckText({ status, checkedAt, updatedAt, listingCount, pages, total, retryAt, error }) {
  const saved = updatedAt ? ' · Saved data from ' + CHECK_TIME.format(new Date(updatedAt)) : '';
  const checked = checkedAt ? ' · ' + CHECK_TIME.format(new Date(checkedAt)) : '';
  if (status === 'feed_required') return 'Authorized feed required' + saved;
  if (status === 'current') return 'Current' + checked;
  if (status === 'updated') return (listingCount === undefined ? 'New data imported' :
    listingCount.toLocaleString('en-US') + ' listings checked' +
      (total > listingCount ? ' out of ' + total.toLocaleString('en-US') + ' reported' : '')) + (pages > 1 ? ' across ' + pages + ' pages' : '') + checked;
  const next = Date.parse(retryAt) > Date.now() ? ' · Next check after ' + CHECK_TIME.format(new Date(retryAt)) : '';
  return (error ?? 'Refresh unavailable') + next + saved;
}

function RentalSyncStatus({ refresh, refreshing, cooldownSeconds, configuredSources, onRefresh, onStreetEasy }) {
  const [expanded, setExpanded] = useState(false);
  const sites = new Map(marketplaceLinks(NYC_SEARCH_MARKETS[0], DEFAULT_FILTERS).map(({ id, name }) => [id, name]));
  for (const { id, name } of [...NYC_COMPANIES, ...configuredSources]) sites.set(id, name);
  sites.set('settled', 'Settled.nyc');
  sites.set('linecity', 'Linecity');
  const statusBySite = new Map();
  for (const source of refresh?.sources ?? []) {
    if (['firstmover', 'housingconnect', 'hdc-rerentals'].includes(source.id)) continue;
    const id = source.marketplace ?? source.id.replace(/-live$/, '');
    if (source.status === 'feed_required' && statusBySite.has(id)) continue;
    statusBySite.set(id, source);
    sites.set(id, source.name);
  }
  const rows = [...sites].map(([id, name]) => {
    const source = statusBySite.get(id);
    const synced = source?.status === 'updated' || source?.status === 'current';
    const pending = (!source || source.status === 'feed_required') &&
      (configuredSources.some((item) => item.id === id) ||
        !source && ['openigloo', 'trulia', 'zumper', 'affordablehousing', 'streeteasy', 'apartments'].includes(id));
    return { id, name, source, synced, state: synced ? 'Synced' : source?.status === 'failed' ?
      'Did not sync' : pending ? 'Awaiting first check' : 'Not connected' };
  }).sort((a, b) => Number(b.synced) - Number(a.synced) || a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  const streetEasy = refresh?.sources.find((source) => source.id === 'streeteasy-live');
  const synced = rows.filter((row) => row.synced).length;
  const failed = rows.filter(({ state }) => state === 'Did not sync').length;
  const disconnected = rows.filter(({ state }) => state === 'Not connected').length;

  return <View style={styles.chartSource}>
    <View style={styles.chipRow}>
      <Button secondary onPress={onRefresh} disabled={!refresh || refreshing || cooldownSeconds > 0}>
        {refreshing ? 'Refreshing listings…' : 'Refresh listings'}
      </Button>
      <Button secondary onPress={onStreetEasy} disabled={!refresh || refreshing || cooldownSeconds > 0}>Fetch all StreetEasy listings</Button>
      <Button secondary onPress={() => setExpanded(!expanded)}>{expanded ? 'Hide sync status' : 'Show sync status'}</Button>
    </View>
    <Text style={styles.smallMuted}>StreetEasy: {streetEasy?.listingCount ?? 0} saved listings{streetEasy?.total != null ? ` from ${streetEasy.total} source records` : ''}. Full inventory is fetched before your search filters. Saved data appears immediately; a failed fetch does not replace it.</Text>
    <Text accessibilityLiveRegion="polite" style={styles.smallMuted}>{synced} synced · {failed} did not sync · {disconnected} not connected</Text>
    {refresh?.lastCheckedAt && <Text style={styles.smallMuted}>Sources last checked {CHECK_TIME.format(new Date(refresh.lastCheckedAt))}</Text>}
    {expanded && <>
      <Text style={styles.smallMuted}>Connected public searches return limited batches. Counts are before your search filters.</Text>
      {rows.map(({ id, name, state, source }) => <Text key={id} style={styles.smallMuted}>
        {name} · {state}{source && state !== 'Awaiting first check' && ` · ${sourceCheckText(source)}`}
      </Text>)}
    </>}
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
      {refresh && <Button secondary onPress={onRefresh} disabled={refreshing || cooldownSeconds > 0}>
        {refreshing ? 'Checking sources…' : 'Refresh listings now'}
      </Button>}
      <Text style={styles.smallMuted}>The app checks available feeds once per session. If a provider limits requests, its next check waits until the retry time.</Text>
      {refresh?.lastCheckedAt && <Text style={styles.fieldLabel}>Last source check · {CHECK_TIME.format(new Date(refresh.lastCheckedAt))}</Text>}
      {refresh?.sources.filter(({ status, marketplace }) => status !== 'feed_required' || !configured.has(marketplace))
        .map((source) => <Text key={source.id} style={styles.smallMuted}>{source.name} · {sourceCheckText(source)}</Text>)}
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

function Results({ result, applied, sort, onSort, onPage, paging, openCommute, commuteConfigured, checkingInventory, columns, savedByKey, showMarkets, onSave, onSaveLink, onRemove, onError }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => { setVisible(PAGE_SIZE); }, [result]);
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
        {Object.entries(RESULT_SORTS).filter(([id]) => id === 'rent' ||
          (!savedView && commuteConfigured && id !== 'recent')).map(([id, label]) =>
          <Chip key={id} selected={sort === id} onPress={() => onSort(id)}>{label}</Chip>)}
      </View>
    </View>
    {result.commute && <Text style={styles.smallMuted}>Weekday-morning estimates from TravelTime.</Text>}
    {result.commuteNotice && <Text style={styles.smallMuted}>{result.commuteNotice}</Text>}
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
        onSave={onSave} onSaveLink={onSaveLink} onError={onError} onRemove={savedView ? onRemove : null} saved={Boolean(saved)} /></View>;
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
      setTab(['results', 'sources', 'chart', 'marketplaces', 'affordable'].includes(next) ? next : 'results');
    };
    restore();
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => { window.removeEventListener('popstate', restore); window.removeEventListener('hashchange', restore); };
  }, []);
  const navigateTab = (next) => {
    if (Platform.OS === 'web' && window.location.hash !== '#' + next) window.history.pushState(null, '', '#' + next);
    setTab(next);
  };
  const [scope, setScope] = useState('market');
  const [adding, setAdding] = useState<false | 'single' | 'import'>(false);
  const [expanded, setExpanded] = useState('');
  const [mapView, setMapView] = useState(wide);
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
          .catch(() => {});
      }
      if (config.refresh) {
        let alreadyChecked = false;
        if (Platform.OS === 'web') {
          try {
            alreadyChecked = sessionStorage.getItem(SESSION_REFRESH_KEY) === 'checked';
            sessionStorage.setItem(SESSION_REFRESH_KEY, 'checked');
          } catch {
            // A browser that disables session storage can still sync when the app opens.
          }
        }
        if (!alreadyChecked || config.refresh.checking) void checkSources(true);
      }
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
    navigateTab('results');
  }

  const toggleFilter = (panel) => setExpanded((current) => current === panel ? '' : panel);
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
    <View style={styles.tabs}>
      {[['results', 'Rent'], ['chart', 'Rent chart'], ['sources', 'Sources'], ['marketplaces', 'Platforms'], ['affordable', 'Affordable']].map(([key, label]) =>
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
          style={[styles.tab, tab === key && styles.tabActive]} onPress={() => navigateTab(key)}>
          <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>{label}</Text>
        </Pressable>)}
    </View>
    {tab === 'results' && <View style={styles.filterBar}>
      <View style={styles.chipRow}>
        <Chip onPress={() => toggleFilter('area')} selected={expanded === 'area'}>{'⌖  ' + marketArea + '  ▾'}</Chip>
        <Chip onPress={() => toggleFilter('price')} selected={expanded === 'price'}>{applied.maxRent === null ? 'Price ▾' : 'Up to ' + formatRent(applied.maxRent) + ' ▾'}</Chip>
        <Chip onPress={() => toggleFilter('beds')} selected={expanded === 'beds'}>{bedroomLabel(applied.bedrooms) + ' ▾'}</Chip>
        <Chip onPress={() => toggleFilter('commute')} selected={expanded === 'commute'}>{commuteLabel + ' ▾'}</Chip>
        <Button secondary onPress={() => toggleFilter('more')}>{expanded === 'more' ? 'Hide filters' : 'More filters'}</Button>
        {WEB_MAP && <Button secondary onPress={() => setMapView(!mapView)}>{mapView ? 'List only' : 'Show map'}</Button>}
      </View>
    </View>}
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
      <View style={styles.shell}>
        {tab === 'results' && expanded && <Filters panel={expanded} draft={draft} setDraft={setDraft} submit={() => submit()}
          busy={busy} serverState={serverState} token={token} setToken={setToken}
          commuteConfigured={commuteConfigured}
          connect={() => setActiveToken(token.trim())} />}
        <View style={styles.results}>
            {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {cooldownSeconds > 0 && !refreshing && <Text accessibilityLiveRegion="polite" style={styles.smallMuted}>Resync available in {cooldownSeconds} seconds. No request will be sent until then.</Text>}
            {refreshing && <Text accessibilityLiveRegion="polite" style={styles.smallMuted}>Checking rental sources…</Text>}
            {!refreshing && failedSources.length > 0 && <Text style={styles.noticeLine}>
              {failedSources.length} {failedSources.length === 1 ? 'source is' : 'sources are'} temporarily unavailable. See Sources for details.
            </Text>}
            {refreshError !== '' && <Text accessibilityRole="alert" style={styles.noticeLine}>{refreshError}</Text>}
            {tab === 'results' && <>
              <View style={styles.resultControls}>
              <View style={styles.scopeRow}>
                <View style={styles.chipRow}>
                  <Chip selected={scope === 'market'} onPress={showMarket}>Available rentals</Chip>
                  <Chip selected={scope === 'saved'} onPress={showSaved}>Saved ({savedResults.total})</Chip>
                </View>
                {!adding && <View style={styles.chipRow}>
                  <Button secondary onPress={() => { setAdding('single'); showSaved(); }}>+ Add listing</Button>
                  <Button secondary onPress={() => { setAdding('import'); showSaved(); }}>Import CSV</Button>
                </View>}
              </View>
              {scope === 'market' && <WebsiteFilter result={result} applied={applied} onSelect={selectSource} onError={setError} />}
              {scope === 'market' && <RentalSyncStatus refresh={refresh} refreshing={refreshing} cooldownSeconds={cooldownSeconds}
                onStreetEasy={() => checkSources(false, 'streeteasy-live')}
                configuredSources={configuredSources} onRefresh={() => checkSources()} />}
              </View>
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
              <View style={[styles.resultLayout, split && styles.resultLayoutWide]}>
                {listVisible && <View style={styles.results}>
                  <Results result={displayed} applied={applied} sort={scope === 'saved' ? SAVED_FILTERS.sort : applied.sort} onSort={selectSort}
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
            {tab === 'chart' && <RentChart initialRegion={applied.region} saved={saved} showSaved={showSaved} onError={setError}
              loadMarket={serverState === 'ready' ? loadMarket : undefined} />}
            {tab === 'sources' && <SourcesPage catalog={sourceCatalog} refresh={refresh} refreshing={refreshing} cooldownSeconds={cooldownSeconds} onResync={(id) => checkSources(false, id ?? null)} />}
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
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><ApartmentSearch /></SafeAreaProvider>;
}

