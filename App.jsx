import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, Pressable, ScrollView, StatusBar,
  Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MARKETS, REGIONS, WORKPLACES } from './src/regions.mjs';
import { marketplaceLinks } from './src/marketplaces.mjs';
import {
  ARRIVAL_TIMES, DEFAULT_FILTERS, bedroomLabel, compareResults,
  directionsLink, formatRent, parseFilters, previewSearch,
} from './src/search.mjs';
import { colors, styles } from './src/styles.js';

const API_ORIGIN = Platform.OS === 'web' ? '' :
  (process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || null);
const BEDROOMS = [null, 0, 1, 2, 3, 4];
const PAGE_SIZE = 12;
const CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
});

const formDefaults = () => ({
  ...DEFAULT_FILTERS,
  maxRent: String(DEFAULT_FILTERS.maxRent),
  maxMiles: '',
  maxMinutes: '',
});

async function api(path, { filters, token, signal } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (filters) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_ORIGIN}/api/${path}`, {
    method: filters ? 'POST' : 'GET', headers, signal,
    body: filters ? JSON.stringify(filters) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Could not reach the apartment search server.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function Chip({ children, selected = false, onPress }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }}
    onPress={onPress} style={({ pressed }) => [styles.chip, selected && styles.chipActive, pressed && styles.pressed]}>
    <Text style={[styles.chipText, selected && styles.chipTextActive]}>{children}</Text>
  </Pressable>;
}

function Button({ children, onPress, secondary = false, disabled = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }}
    onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary,
      (pressed || disabled) && styles.pressed]}>
    <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{children}</Text>
  </Pressable>;
}

function Link({ label, url, onError }) {
  return <Pressable accessibilityRole="link" onPress={() => {
    Linking.openURL(url).catch(() => onError('This link could not be opened on your device.'));
  }} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
    <Text style={styles.linkText}>{label} ↗</Text>
  </Pressable>;
}

function SectionTitle({ index, children }) {
  return <View style={styles.sectionTitle}>
    <Text style={styles.sectionIndex}>{index}</Text>
    <Text accessibilityRole="header" style={styles.sectionHeading}>{children}</Text>
  </View>;
}

function Field({ label, placeholder, value, onChangeText, keyboardType, maxLength, secureTextEntry }) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText}
      placeholder={placeholder} placeholderTextColor={colors.muted} style={styles.input}
      keyboardType={keyboardType} maxLength={maxLength} secureTextEntry={secureTextEntry}
      autoCapitalize={secureTextEntry ? 'none' : 'sentences'} autoCorrect={false} />
  </View>;
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

function Filters({ draft, setDraft, submit, busy, transit, serverState, token, setToken, connect }) {
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
    {transit ? <>
      <Field label="Max scheduled transit time (min)" placeholder="Any transit time" value={draft.maxMinutes}
        onChangeText={set('maxMinutes')} keyboardType="number-pad" maxLength={3} />
      <Text style={styles.fieldLabel}>Arrive by, next weekday</Text>
      <View style={styles.chipRow}>
        {ARRIVAL_TIMES.map((time) => <Chip key={time} selected={draft.arrival === time}
          onPress={() => set('arrival')(time)}>{time.replace(/^0/, '')} AM</Chip>)}
      </View>
    </> : <Text style={styles.smallMuted}>Scheduled transit filtering becomes available when live listings and Google Routes are connected.</Text>}
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

function Listing({ listing, number, workplace, onError }) {
  const { region, demo, title, address, unit, city, state, zip, rent, bedrooms, miles, transitSeconds, transitMiles, sources } = listing;
  const regionInfo = REGIONS[region];
  const listingTitle = demo ? title : [address, unit].filter(Boolean).join(', ');
  const addressSearch = 'https://www.google.com/search?' +
    new URLSearchParams({ q: `${[address, unit, city, state, zip].filter(Boolean).join(' ')} apartment for rent` });
  const links = sources.filter((source) => source.url);

  return <View style={styles.listing}>
    <View style={styles.listingTop}>
      <View style={styles.listingContent}>
        <View style={styles.listingKicker}>
          <Text style={styles.rank}>{String(number).padStart(2, '0')}</Text>
          <View style={[styles.regionDot, { backgroundColor: regionInfo.color }]} />
          <Text style={[styles.regionLabel, { color: regionInfo.color }]}>{regionInfo.label}</Text>
        </View>
        <Text accessibilityRole="header" style={styles.listingTitle}>{listingTitle}</Text>
        <Text style={styles.smallMuted}>{city}, {state} {zip}</Text>
      </View>
      <View style={styles.priceBlock}>
        <Text style={styles.price}>{formatRent(rent)}</Text>
        <Text style={styles.smallMuted}>per month</Text>
      </View>
    </View>
    <View style={styles.cardStats}>
      <Text style={styles.cardStat}>{bedroomLabel(bedrooms)}</Text>
      <Text style={styles.cardStat}>{miles === null ? 'Distance unavailable' : `${miles.toFixed(1)} mi straight-line`}</Text>
      {transitSeconds !== null && <Text style={styles.cardStat}>{Math.ceil(transitSeconds / 60)} min transit{transitMiles === null ? '' : ` · ${transitMiles.toFixed(1)} mi route`}</Text>}
    </View>
    <View style={styles.cardActions}>
      <Text style={styles.smallMuted}>{demo ? 'Example listing' : sources.map((source) => source.name).join(' · ')}</Text>
      <View style={styles.actionLinks}>
        {!demo && (links.length ? links.map((source) =>
          <Link key={source.id} label={source.name} url={source.url} onError={onError} />) :
          <Link label="Search this address" url={addressSearch} onError={onError} />)}
        <Link label={demo ? 'Area directions' : 'Transit directions'} url={directionsLink(listing, workplace)} onError={onError} />
      </View>
    </View>
  </View>;
}

function Marketplaces({ filters, sources, onError }) {
  const markets = MARKETS.filter((market) => filters.region === 'all' || market.region === filters.region);
  const [marketLabel, setMarketLabel] = useState('');
  const market = markets.find((item) => item.label === marketLabel) ??
    markets.find((item) => item.zip === filters.zip) ?? markets[0];
  const searchFeeds = new Set(sources.filter(({ status }) => status === 'searched').map(({ id }) => id));
  const configured = new Set(sources.map(({ id }) => id));

  return <View style={styles.marketplacePanel}>
    <Text accessibilityRole="header" style={styles.panelTitle}>Browse rental platforms</Text>
    <Text style={styles.bodyText}>Open listings on each marketplace. Some carry the same units. The rent and bedroom filters travel with the link where supported.</Text>
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
          <Text style={styles.marketType}>{searchFeeds.has(id) ? 'LIVE FEED' : configured.has(id) ? 'FEED UNAVAILABLE' : 'BROWSE'}</Text>
        </Pressable>)}
    </View>
  </View>;
}

function Results({ result, applied, showMarkets, serverState, busy, onError }) {
  const [sort, setSort] = useState('rent');
  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => { setVisible(PAGE_SIZE); setSort('rent'); }, [result]);

  if (!result) {
    return <View style={styles.empty}>
      {busy ? <ActivityIndicator color={colors.green} /> : <Text accessibilityRole="header" style={styles.panelTitle}>Run your first live search</Text>}
      <Text style={styles.bodyText}>Choose your filters to find active rentals from your connected feeds.</Text>
    </View>;
  }

  const matches = [...result.matches].sort((first, second) => compareResults(first, second, sort));
  const summary = [
    REGIONS[applied.region].label, bedroomLabel(applied.bedrooms), applied.zip,
    applied.maxRent === null ? null : `Up to ${formatRent(applied.maxRent)}`,
    applied.maxMiles === null ? null : `Within ${applied.maxMiles} mi`,
    applied.maxMinutes === null ? null : `Up to ${applied.maxMinutes} min`,
  ].filter(Boolean).join(' · ');

  return <>
    {result.mode === 'demo' && <View style={styles.demoNotice}>
      <View style={styles.demoMark}><Text style={styles.demoMarkText}>i</Text></View>
      <View style={styles.noticeCopy}>
        <Text style={styles.noticeTitle}>Preview data</Text>
        <Text style={styles.bodyText}>{serverState === 'offline' ? 'The live server could not be reached. ' : ''}
          The cards below use sample rents and locations. Open a rental platform to see current listings.</Text>
        <Pressable accessibilityRole="button" onPress={showMarkets}><Text style={styles.linkText}>Browse rental platforms →</Text></Pressable>
      </View>
    </View>}
    <View style={styles.resultHeading}>
      <View style={styles.headingCopy}>
        <Text accessibilityRole="header" style={styles.panelTitle}>{result.total} {result.mode === 'demo' ? 'example' : 'matching'} {result.total === 1 ? 'apartment' : 'apartments'}</Text>
        <Text style={styles.smallMuted}>{summary}</Text>
        <Text style={styles.smallMuted}>To {result.workplace.label}</Text>
        {result.transitArrival && <Text style={styles.smallMuted}>Arrive {CLOCK.format(new Date(result.transitArrival))} ET · Google Maps</Text>}
      </View>
      <View style={styles.chipRow}>
        <Chip selected={sort === 'rent'} onPress={() => setSort('rent')}>Lowest rent</Chip>
        <Chip selected={sort === 'distance'} onPress={() => setSort('distance')}>Closest</Chip>
        {result.transitArrival && <Chip selected={sort === 'transit'} onPress={() => setSort('transit')}>Fastest transit</Chip>}
      </View>
    </View>
    {result.notices.map((notice) => <Text key={notice} style={styles.noticeLine}>{notice}</Text>)}
    {matches.length === 0 && <View style={styles.empty}>
      <Text accessibilityRole="header" style={styles.panelTitle}>No matches</Text>
      <Text style={styles.bodyText}>Try a higher rent limit, a larger area, or a longer commute.</Text>
      <Button secondary onPress={showMarkets}>Browse rental platforms</Button>
    </View>}
    {matches.slice(0, visible).map((listing, index) =>
      <Listing key={listing.id} listing={listing} number={index + 1} workplace={result.workplace} onError={onError} />)}
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
  const [result, setResult] = useState(() => previewSearch(DEFAULT_FILTERS));
  const [serverState, setServerState] = useState(API_ORIGIN === null ? 'preview' : 'checking');
  const [transit, setTransit] = useState(false);
  const [token, setToken] = useState('');
  const [activeToken, setActiveToken] = useState('');
  const [tab, setTab] = useState('results');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (API_ORIGIN === null) return;
    const controller = new AbortController();
    api('config', { token: activeToken, signal: controller.signal }).then((config) => {
      setServerState('ready');
      setTransit(config.transit);
      if (config.mode === 'live') setResult(null);
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      setServerState(failure.status === 401 ? 'locked' : 'offline');
      if (failure.status === 401) setExpanded(true);
    });
    return () => controller.abort();
  }, [activeToken]);

  async function submit() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const filters = parseFilters(draft);
      const searchResult = serverState === 'ready' || serverState === 'checking' ?
        await api('search', { filters, token: activeToken }) : previewSearch(filters);
      setApplied(filters);
      setResult(searchResult);
      setTab('results');
      if (!wide) setExpanded(false);
    } catch (failure) {
      setError(failure.message || 'Search could not be completed.');
    } finally {
      setBusy(false);
    }
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
            {(wide || expanded) && <Filters draft={draft} setDraft={setDraft} submit={submit}
              busy={busy} transit={transit} serverState={serverState} token={token} setToken={setToken}
              connect={() => setActiveToken(token.trim())} />}
          </View>
          <View style={styles.results}>
            <View style={styles.tabs}>
              {[['results', 'Results'], ['marketplaces', 'Rental platforms']].map(([key, label]) =>
                <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
                  style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)}>
                  <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>{label}</Text>
                </Pressable>)}
            </View>
            {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            {tab === 'results' ?
              <Results result={result} applied={applied} busy={busy} serverState={serverState}
                showMarkets={() => setTab('marketplaces')} onError={setError} /> :
              <Marketplaces filters={applied} sources={result?.sources ?? []} onError={setError} />}
          </View>
        </View>
        <View style={styles.footer}>
          <Text style={styles.smallMuted}>Apartment Search · New York, New Jersey and Connecticut</Text>
          <Text style={styles.smallMuted}>Distances in miles are straight-line unless marked as route distance.</Text>
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><ApartmentSearch /></SafeAreaProvider>;
}
