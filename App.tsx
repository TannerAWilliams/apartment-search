import { searchAvailabilityMessage } from './src/search-availability.ts';
import { ErrorBoundary } from './src/ErrorBoundary.tsx';
import { useHashNavigation, useInventoryClock, useSavedListings } from './src/app-hooks.ts';
import { inventoryExpired } from './src/inventory-freshness.ts';
import type { ListingData, SourceLink, SearchResult } from './src/domain.ts';

import { Modal, Platform, Pressable, ScrollView, StatusBar, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { REGIONS, regionOf } from './src/regions.ts';
import { bedroomLabel, formatRent, localWorkplace, needsCommute, parseFilters } from './src/search.ts';
import { mobileStyles } from './src/mobileStyles.ts';
import { colors, styles } from './src/styles.ts';
import { localSearch } from './src/market.ts';
import { listingKey, mergeListings, mergeSourceLinks } from './src/listings.ts';
import { Button, Chip } from './src/ui.tsx';
import { startVitals } from './src/web-vitals-report.ts';
import { SavedSearches } from './src/SavedSearches.tsx';
import { ObservedChanges } from './src/ObservedChanges.tsx';
import {
  failureInfo,
  WEB_MAP,
  SEARCH_DEFAULTS,
  PAGE_SIZE,
  TOOLS,
  EMPTY_POINTS,
  SAVED_FILTERS,
  formDefaults,
  api,
} from './src/app-shared.ts';
import { Filters, WebsiteFilter } from './src/Filters.tsx';
import { Marketplaces } from './src/Marketplaces.tsx';
import { Results } from './src/Results.tsx';
import { useServer } from './src/use-server.ts';
import React, { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Screens off the first page load on first use, so opening the app downloads only what search needs.
const ListingMap = lazy(() => import('./src/ListingMap').then((module) => ({ default: module.ListingMap })));
const AffordableHousing = lazy(() => import('./src/AffordableHousing.tsx').then((module) => ({ default: module.AffordableHousing })));
const AddListing = lazy(() => import('./src/AddListing.tsx').then((module) => ({ default: module.AddListing })));
const ImportListings = lazy(() => import('./src/ImportListings.tsx').then((module) => ({ default: module.ImportListings })));
const SourcesPage = lazy(() => import('./src/SourcesPage.tsx').then((module) => ({ default: module.SourcesPage })));
const SavedComparison = lazy(() => import('./src/SavedComparison.tsx').then((module) => ({ default: module.SavedComparison })));
const TourPlanner = lazy(() => import('./src/TourPlanner.tsx').then((module) => ({ default: module.TourPlanner })));
const RentChart = lazy(() => import('./src/RentChart.tsx').then((module) => ({ default: module.RentChart })));
const AlertsPage = lazy(() => import('./src/AlertsPage.tsx').then((module) => ({ default: module.AlertsPage })));

function ApartmentSearch() {
  const { width } = useWindowDimensions();
  const wide = width >= 980;
  const [draft, setDraft] = useState(formDefaults);
  const [applied, setApplied] = useState(SEARCH_DEFAULTS);
  const [result, setResult] = useState<SearchResult>(() => localSearch([], SEARCH_DEFAULTS, localWorkplace(SEARCH_DEFAULTS), 'live'));
  const inventoryClock = useInventoryClock(result);
  const staleInventory = inventoryExpired(result, inventoryClock);
  const [visible, setVisible] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [result]);
  const submitted = useRef(false);
  const searchVersion = useRef(0);
  const appliedFilters = useRef(SEARCH_DEFAULTS);
  const { tab, navigateTab, scope, setScope, expanded, setExpanded } = useHashNavigation();
  /** The open tool panel below the commute box: one at a time. */
  const [tool, setTool] = useState('');
  const [adding, setAdding] = useState<false | 'single' | 'import'>(false);
  const [mapView, setMapView] = useState(false);
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  /** The tab the scroll offset belongs to; null from a tab change until that tab's offset is restored. */
  const scrollTab = useRef<string | null>(null);
  // A layout effect, so scroll events from the new tab's content (or a late scroll-end event from the
  // previous tab) cannot be recorded against the wrong tab before the restore.
  useLayoutEffect(() => {
    scrollTab.current = null;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: scrollPositions.current[tab] ?? 0, animated: false });
      scrollTab.current = tab;
    });
    return () => cancelAnimationFrame(frame);
  }, [tab]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useSavedListings(setError);
  const {
    serverState,
    connect,
    signedIn,
    signOut,
    account,
    configuredSources,
    companies,
    sourceCatalog,
    refresh,
    refreshing,
    refreshError,
    cooldownSeconds,
    token,
    setToken,
    activeToken,
    commuteConfigured,
    dashboardAvailable,
    freshness,
    checkSources,
    loadMarket,
    loadDashboard,
    alertRequest,
    loadHousing,
    checkBuilding,
  } = useServer({ appliedFilters, searchVersion, submitted, setResult, setError, setExpanded });
  const savedByKey = useMemo(() => new Map(saved.map((listing) => [listingKey(listing), listing])), [saved]);
  const savedResults = useMemo(() => localSearch(saved, SAVED_FILTERS, result.workplace, 'saved'), [saved, result.workplace]);

  const searchSummary = [
    REGIONS[applied.region as keyof typeof REGIONS]?.label ?? 'All regions',
    bedroomLabel(applied.bedrooms),
    applied.maxRent == null ? 'Any price' : 'Up to ' + formatRent(applied.maxRent),
  ].join(' · ');

  async function submit(nextDraft: typeof draft | typeof applied = draft) {
    if (busy) return;
    const unavailable = searchAvailabilityMessage(serverState);
    if (unavailable) {
      setError(unavailable);
      return;
    }
    submitted.current = true;
    searchVersion.current += 1;
    setError('');
    setBusy(true);
    const changingDestination = nextDraft.workplace !== applied.workplace || nextDraft.customWorkplace !== applied.customWorkplace;
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
      const searchResult = await api('search', { body: filters, token: activeToken });
      appliedFilters.current = filters;
      setApplied(filters);
      setResult(searchResult);
      setScope('market');
      setAdding(false);
      navigateTab('results');
      setExpanded('');
    } catch (caught) {
      const failure = failureInfo(caught);
      if (failure.commuteError) setExpanded('commute');
      setError(
        (failure.message || 'Search could not be completed.') +
          (changingDestination ? ' Destination was not changed; previous results are still shown.' : ''),
      );
    } finally {
      setBusy(false);
    }
  }

  async function fetchPage(offset: number) {
    if (busy || serverState !== 'ready') return;
    const version = ++searchVersion.current;
    const filters = appliedFilters.current;
    setBusy(true);
    setError('');
    try {
      const page = await api('search', { body: { ...filters, offset }, token: activeToken });
      if (searchVersion.current === version && appliedFilters.current === filters) setResult(page);
    } catch (caught) {
      const failure = failureInfo(caught);
      setError(failure.message || 'Could not load the next page.');
    } finally {
      setBusy(false);
    }
  }

  function searchCompany(company: string) {
    const nextDraft = { ...formDefaults(), company, bedrooms: null, maxRent: '' };
    setDraft(nextDraft);
    submit(nextDraft);
  }

  function selectSort(sort: string) {
    if (busy || sort === applied.sort) return;
    setDraft((current) => ({ ...current, sort }));
    submit({ ...applied, sort });
  }

  function saveListing(listing: ListingData) {
    setSaved((current) => mergeListings([...current, { ...listing, buildingLinks: undefined }]));
  }

  function saveLink(listing: ListingData, link: SourceLink) {
    saveListing({ ...listing, sources: mergeSourceLinks(listing.sources, [link]) });
  }

  function showSaved() {
    setScope('saved');
    navigateTab('saved');
  }

  const toggleFilter = (panel: string) => {
    setDraft({
      ...formDefaults(),
      ...applied,
      maxRent: applied.maxRent == null ? '' : String(applied.maxRent),
      maxTransitMinutes: applied.maxTransitMinutes == null ? '' : String(applied.maxTransitMinutes),
      maxDrivingMinutes: applied.maxDrivingMinutes == null ? '' : String(applied.maxDrivingMinutes),
    });
    setExpanded((current) => (current === panel ? '' : panel));
  };
  const displayed = scope === 'saved' ? savedResults : result;
  const points = displayed.mapPoints ?? EMPTY_POINTS;
  const split = WEB_MAP && wide && mapView;
  const listVisible = !WEB_MAP || !mapView || wide;
  const marketArea = Object.entries(REGIONS).find(([key]) => key === applied.region)?.[1].label ?? applied.region;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" {...{ backgroundColor: colors.navy }} />
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Text style={styles.brandLetter}>A</Text>
          </View>
          <Text style={styles.brandText}>Apartment Search</Text>
        </View>
        <Text style={styles.topLabel}>NYC METRO</Text>
      </View>
      {(tab === 'results' || tab === 'saved') && (
        <View style={mobileStyles.searchBar}>
          <View style={mobileStyles.summary}>
            <Text numberOfLines={1} style={styles.fieldLabel}>
              {tab === 'saved' ? 'Your saved apartments' : marketArea}
            </Text>
            <Text numberOfLines={1} style={styles.smallMuted}>
              {tab === 'saved'
                ? 'All apartment sizes · Any price'
                : bedroomLabel(applied.bedrooms) + ' · ' + (applied.maxRent == null ? 'Any price' : 'Up to ' + formatRent(applied.maxRent))}
            </Text>
          </View>
          {tab === 'results' && (
            <Button secondary onPress={() => toggleFilter('more')}>
              Filters
            </Button>
          )}
          {WEB_MAP && (
            <Button secondary onPress={() => setMapView(!mapView)}>
              {mapView ? 'List' : 'Map'}
            </Button>
          )}
        </View>
      )}
      {(tab === 'results' || tab === 'saved') && (
        <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6, borderBottomWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.fieldLabel, { flex: 1, minWidth: 0 }]} numberOfLines={2}>
              Commute to: {result.workplace.label}
            </Text>
            <Button
              secondary
              disabled={busy}
              onPress={() => {
                setError('');
                toggleFilter('commute');
              }}
            >
              Change destination
            </Button>
          </View>
          <Text style={styles.smallMuted}>
            {tab === 'saved'
              ? 'Directions use this destination. Automatic travel times are not recalculated on your saved list.'
              : busy
                ? 'Updating search. Previous destination and results remain until it succeeds.'
                : result.commute
                  ? 'Weekday-morning provider estimates; missing routes stay unavailable.'
                  : result.commuteNotice || 'Automatic travel times unavailable. Open a listing’s directions link to check a route.'}
          </Text>
        </View>
      )}
      <Modal visible={Boolean(expanded)} transparent animationType="slide" onRequestClose={() => setExpanded('')}>
        <View style={mobileStyles.overlay}>
          <View style={[mobileStyles.sheet, wide && mobileStyles.wideSheet]} accessibilityViewIsModal>
            <View style={mobileStyles.sheetHeader}>
              <Text accessibilityRole="header" style={[styles.panelTitle, { flex: 1, minWidth: 0 }]}>
                {expanded === 'commute' ? 'Change commute destination' : 'Search filters'}
              </Text>
              <Button secondary onPress={() => setExpanded('')}>
                Cancel
              </Button>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {error !== '' && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              )}
              <Filters
                panel={expanded}
                draft={draft}
                setDraft={setDraft}
                submit={() => submit()}
                busy={busy}
                serverState={serverState}
                token={token}
                setToken={setToken}
                commuteConfigured={commuteConfigured}
                connect={connect}
                onSignedIn={signedIn}
                account={account}
                onSignOut={() => void signOut()}
              />
              {expanded !== 'commute' && (
                <WebsiteFilter
                  result={result}
                  applied={draft}
                  onSelect={(source) => setDraft((current) => ({ ...current, source }))}
                  onError={setError}
                  configuredSources={configuredSources}
                />
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <ScrollView
        ref={scrollRef}
        testID="main-scroll"
        onScroll={(event) => {
          if (scrollTab.current) scrollPositions.current[scrollTab.current] = event.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scroll}
      >
        <View style={styles.shell}>
          <View style={styles.results}>
            <Suspense fallback={<Text style={styles.smallMuted}>Loading…</Text>}>
              {error !== '' && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              )}
              {(tab === 'results' || tab === 'saved') && (
                <>
                  <View style={styles.chipRow}>
                    {TOOLS[tab]
                      .filter(([id]) => id !== 'changes' || !staleInventory)
                      .map(([id, short, full]) => (
                        <Chip key={id} label={full} selected={tool === id} onPress={() => setTool(tool === id ? '' : id)}>
                          {short}
                        </Chip>
                      ))}
                  </View>
                  {tab === 'saved' && <SavedComparison listings={saved} open={tool === 'compare'} />}
                  {tab === 'saved' && <TourPlanner listings={saved} open={tool === 'tours'} />}
                  {tab === 'results' && (
                    <SavedSearches
                      open={tool === 'searches'}
                      filters={applied}
                      disabled={busy}
                      apply={(filters) => {
                        const next = { ...filters, includeMap: WEB_MAP };
                        setDraft({ ...formDefaults(), ...next });
                        submit(next);
                      }}
                      check={(filters) => {
                        if (serverState !== 'ready')
                          return Promise.reject(new Error('Connect to the inventory server before checking a saved search.'));
                        return api('search-check', { body: filters, token: activeToken });
                      }}
                    />
                  )}
                  {tab === 'results' && !staleInventory && <ObservedChanges listings={result.matches} open={tool === 'changes'} />}
                  {tab === 'results' && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={freshness + ' · Details: source freshness and coverage'}
                      onPress={() => navigateTab('sources')}
                    >
                      <Text style={mobileStyles.freshness}>{freshness} · Details</Text>
                    </Pressable>
                  )}
                  {tab === 'results' && staleInventory && (
                    <View style={styles.empty}>
                      <Text accessibilityRole="header" style={styles.panelTitle}>
                        These results need a fresh check
                      </Text>
                      <Text style={styles.bodyText}>
                        Their source freshness window has expired. The old results and map are hidden rather than presented as current
                        availability. Search again to read the server’s cached inventory, or review source status. No provider refresh runs
                        automatically from this notice.
                      </Text>
                      <Button secondary onPress={() => navigateTab('sources')}>
                        Review source status
                      </Button>
                    </View>
                  )}
                  {(tab === 'saved' || !staleInventory) && (
                    <View style={[styles.resultLayout, split && styles.resultLayoutWide]}>
                      {listVisible && (
                        <View style={styles.results}>
                          <Results
                            onCheckBuilding={serverState === 'ready' ? checkBuilding : undefined}
                            visible={visible}
                            setVisible={setVisible}
                            result={displayed}
                            applied={applied}
                            sort={scope === 'saved' ? SAVED_FILTERS.sort : applied.sort}
                            onSort={selectSort}
                            onPage={fetchPage}
                            paging={busy}
                            openCommute={() => setExpanded('commute')}
                            commuteConfigured={commuteConfigured}
                            checkingInventory={refreshing || serverState === 'checking' || busy}
                            columns={wide}
                            savedByKey={savedByKey}
                            showMarkets={() => navigateTab('marketplaces')}
                            showSources={() => navigateTab('sources')}
                            onSave={saveListing}
                            onSaveLink={saveLink}
                            onRemove={(listing) =>
                              setSaved((current) => current.filter((item) => listingKey(item) !== listingKey(listing)))
                            }
                            onError={setError}
                          />
                        </View>
                      )}
                      {WEB_MAP && mapView && (
                        <View style={[styles.mapPanel, split && styles.mapPanelWide]}>
                          <Suspense fallback={<Text style={styles.smallMuted}>Loading map…</Text>}>
                            <ListingMap points={points} total={displayed.total} visible />
                          </Suspense>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}
              {tab === 'more' && (
                <View style={styles.filters}>
                  <Text accessibilityRole="header" style={styles.panelTitle}>
                    More
                  </Text>
                  {[
                    ['sources', 'Sources & sync'],
                    ['alerts', 'Alerts'],
                    ['chart', 'Rent chart'],
                    ['marketplaces', 'Rental platforms'],
                    ['affordable', 'Affordable housing'],
                  ].map(([key, label]) => (
                    <Button key={key} secondary onPress={() => navigateTab(key)}>
                      {label}
                    </Button>
                  ))}
                </View>
              )}
              {tab === 'chart' && (
                <RentChart
                  initialRegion={applied.region}
                  saved={saved}
                  showSaved={showSaved}
                  onError={setError}
                  loadMarket={serverState === 'ready' ? loadMarket : undefined}
                  loadDashboard={serverState === 'ready' && dashboardAvailable ? loadDashboard : undefined}
                />
              )}
              {tab === 'sources' && (
                <>
                  <Text accessibilityRole="header" style={styles.panelTitle}>
                    Sources & sync
                  </Text>
                  {refreshError !== '' && (
                    <Text accessibilityRole="alert" style={styles.noticeLine}>
                      {refreshError}
                    </Text>
                  )}
                  <View style={styles.chipRow}>
                    <Button secondary onPress={() => setAdding('single')}>
                      + Add listing
                    </Button>
                    <Button secondary onPress={() => setAdding('import')}>
                      Import CSV
                    </Button>
                  </View>
                  {adding === 'single' && (
                    <AddListing
                      initialRegion={applied.region}
                      onSave={(listing) => {
                        saveListing(listing);
                        setAdding(false);
                      }}
                      onCancel={() => setAdding(false)}
                      geocode={serverState === 'ready' ? (address) => api('geocode', { body: { address }, token: activeToken }) : undefined}
                    />
                  )}
                  {adding === 'import' && (
                    <ImportListings
                      onImport={(listings) => {
                        if (listings.some((listing) => !regionOf(listing))) {
                          throw new Error(
                            'Import listings in NYC, New Jersey, Long Island, the Hudson Valley, Connecticut or eastern Pennsylvania.',
                          );
                        }
                        setSaved((current) => mergeListings([...listings, ...current]));
                        setAdding(false);
                      }}
                      onCancel={() => setAdding(false)}
                    />
                  )}
                  <SourcesPage
                    catalog={sourceCatalog}
                    refresh={refresh}
                    refreshing={refreshing}
                    cooldownSeconds={cooldownSeconds}
                    onResync={(id) => checkSources(id ?? null)}
                  />
                </>
              )}
              {tab === 'marketplaces' && (
                <Marketplaces
                  filters={applied}
                  sources={result.sources}
                  configuredSources={configuredSources}
                  companies={companies}
                  onCompany={searchCompany}
                  refresh={refresh}
                  onError={setError}
                />
              )}
              {tab === 'alerts' && <AlertsPage request={alertRequest} filters={applied} summary={searchSummary} onError={setError} />}
              {tab === 'affordable' && (
                <AffordableHousing
                  region={applied.region}
                  loadHousing={serverState === 'ready' ? loadHousing : undefined}
                  onError={setError}
                />
              )}
            </Suspense>
          </View>
          <View style={styles.footer}>
            <Text style={styles.smallMuted}>Apartment Search · New York, New Jersey and Connecticut</Text>
          </View>
        </View>
      </ScrollView>
      <View style={mobileStyles.bottomNav} accessibilityRole="tablist">
        {[
          ['results', 'Search'],
          ['saved', `Saved (${savedResults.total})`],
          ['more', 'More'],
        ].map(([key, label]) => {
          const selected = key === 'more' ? !['results', 'saved'].includes(tab) : tab === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              aria-selected={selected}
              accessibilityState={{ selected }}
              style={[mobileStyles.navItem, selected && mobileStyles.navSelected]}
              onPress={() => navigateTab(key)}
            >
              <Text style={styles.tabLabel}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  useEffect(() => {
    if (Platform.OS === 'web') startVitals().catch(() => {});
  }, []);
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ApartmentSearch />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
