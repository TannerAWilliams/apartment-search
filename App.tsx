import { searchAvailabilityMessage } from './src/search-availability.ts';
import { ErrorBoundary } from './src/components/ErrorBoundary.tsx';
import { useAccountSaved, useHashNavigation, useInventoryClock, useSavedListings } from './src/hooks/app-hooks.ts';
import { inventoryExpired } from './src/inventory-freshness.ts';
import type { ListingData, SourceLink, SearchResult } from './src/domain.ts';

import { Modal, Platform, Pressable, ScrollView, StatusBar, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { REGIONS, boroughKey } from './src/regions.ts';
import { bedroomLabel, formatRent, localWorkplace, needsCommute, parseFilters } from './src/search.ts';
import { mobileStyles } from './src/mobileStyles.ts';
import { colors, styles } from './src/styles.ts';
import { localSearch } from './src/market.ts';
import { listingKey, mapListing, mergeListings, mergeSourceLinks } from './src/listings.ts';
import { Button, Chip } from './src/components/ui.tsx';
import { startVitals } from './src/web-vitals-report.ts';
import { SavedSearches } from './src/components/SavedSearches.tsx';
import { ObservedChanges } from './src/components/ObservedChanges.tsx';
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
import { Filters, WebsiteFilter } from './src/components/Filters.tsx';
import { HomePage } from './src/screens/HomePage.tsx';
import { AccountPrompt } from './src/components/AccountPrompt.tsx';
import { CategoryBar } from './src/components/CategoryBar.tsx';
import { StreetViewContext } from './src/components/ListingThumbnail.tsx';
import {
  BrandMark,
  ChartIcon,
  CloseIcon,
  HeartIcon,
  ListIcon,
  MapIcon,
  ProfileIcon,
  SearchIcon,
  SlidersIcon,
} from './src/components/Icons.tsx';
import { Marketplaces } from './src/screens/Marketplaces.tsx';
import { Results } from './src/screens/Results.tsx';
import { useServer } from './src/hooks/use-server.ts';
import React, { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Screens off the first page load on first use, so opening the app downloads only what search needs.
const ListingMap = lazy(() => import('./src/components/ListingMap').then((module) => ({ default: module.ListingMap })));
const AffordableHousing = lazy(() =>
  import('./src/screens/AffordableHousing.tsx').then((module) => ({ default: module.AffordableHousing })),
);
const SourcesPage = lazy(() => import('./src/screens/SourcesPage.tsx').then((module) => ({ default: module.SourcesPage })));
const SavedComparison = lazy(() => import('./src/components/SavedComparison.tsx').then((module) => ({ default: module.SavedComparison })));
const TourPlanner = lazy(() => import('./src/components/TourPlanner.tsx').then((module) => ({ default: module.TourPlanner })));
const RentChart = lazy(() => import('./src/components/RentChart.tsx').then((module) => ({ default: module.RentChart })));
const ProfilePage = lazy(() => import('./src/screens/ProfilePage.tsx').then((module) => ({ default: module.ProfilePage })));
const SharedListPage = lazy(() => import('./src/screens/SharedListPage.tsx').then((module) => ({ default: module.SharedListPage })));
const ApplyPage = lazy(() => import('./src/screens/ApplyPage.tsx').then((module) => ({ default: module.ApplyPage })));
const NeighborhoodsPage = lazy(() =>
  import('./src/screens/NeighborhoodsPage.tsx').then((module) => ({ default: module.NeighborhoodsPage })),
);
const RenewalPage = lazy(() => import('./src/screens/NeighborhoodsPage.tsx').then((module) => ({ default: module.RenewalPage })));
const AdminPage = lazy(() => import('./src/screens/AdminPage.tsx').then((module) => ({ default: module.AdminPage })));
const LegalPage = lazy(() => import('./src/screens/LegalPage.tsx').then((module) => ({ default: module.LegalPage })));
const ListingPage = lazy(() => import('./src/screens/ListingPage.tsx').then((module) => ({ default: module.ListingPage })));
const DirectPage = lazy(() => import('./src/screens/DirectPage.tsx').then((module) => ({ default: module.DirectPage })));
const AffordPage = lazy(() => import('./src/screens/AffordPage.tsx').then((module) => ({ default: module.AffordPage })));
const AlertsPage = lazy(() => import('./src/screens/AlertsPage.tsx').then((module) => ({ default: module.AlertsPage })));

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
    admin,
    plan,
    membersRequest,
    householdRequest,
    billingRequest,
    loadListing,
    directRequest,
    loadAdminStats,
    accountRequest,
    loadNeighborhoodReport,
    configuredSources,
    companies,
    sourceCatalog,
    refresh,
    refreshing,
    refreshError,
    cooldownSeconds,
    activeToken,
    commuteConfigured,
    dashboardAvailable,
    streetViewAvailable,
    freshness,
    checkSources,
    loadMarket,
    loadHistory,
    alertRequest,
    loadNeighborhoods,
    savedRequest,
    settingsRequest,
    loadHousing,
    checkBuilding,
  } = useServer({ appliedFilters, searchVersion, submitted, setResult, setError });
  useAccountSaved(saved, setSaved, account, serverState === 'ready' ? savedRequest : undefined, setError);
  const savedByKey = useMemo(() => new Map(saved.map((listing) => [listingKey(listing), listing])), [saved]);
  const savedResults = useMemo(() => localSearch(saved, SAVED_FILTERS, result.workplace, 'saved'), [saved, result.workplace]);

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

  const savedKeys = useMemo(() => new Set(saved.map(listingKey)), [saved]);

  /** Saving belongs to an account: a visitor is asked to create one first. */
  function saveListing(listing: ListingData) {
    if (!member) {
      navigateTab('saved');
      return;
    }
    setSaved((current) => mergeListings([...current, { ...listing, buildingLinks: undefined }]));
    showToast('Saved to your list');
  }

  // A short confirmation at the bottom after saving, with a way to the list, as listing apps confirm a save.
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
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

  // The browser tab names the screen, so tabs and history are told apart.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const title = tab.startsWith('listing=') ? 'Apartment' : (PAGE_TITLES[tab] ?? 'Walkup');
    document.title = tab === 'home' ? title : `${title} · Walkup`;
  }, [tab]);

  // A visitor (no account, not the app's own admin token) uses everything except what belongs to an account.
  const member = Boolean(account) || admin;
  const view = !member && ACCOUNT_TABS[tab] ? 'account' : tab;

  // The main screens. On a phone they are the tab bar at the bottom; on a wider screen, links in the header,
  // as websites put them. Search comes first: it is what people come for.
  const navigation = (
    <View
      accessibilityRole="tablist"
      style={wide ? { flexDirection: 'row', gap: 4, alignItems: 'center' } : { flexDirection: 'row', flex: 1 }}
    >
      {(
        [
          ['results', 'Search', SearchIcon],
          ['chart', 'Rents', ChartIcon],
          ['saved', `Saved (${savedResults.total})`, HeartIcon],
          ['more', 'Profile', ProfileIcon],
        ] as const
      ).map(([key, label, Icon]) => {
        const selected = key === 'more' ? !['home', 'chart', 'results', 'saved'].includes(tab) : tab === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            aria-selected={selected}
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            style={({ pressed }) => [
              wide
                ? {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: selected ? colors.light : 'transparent',
                  }
                : [mobileStyles.navItem, selected && mobileStyles.navSelected],
              pressed && styles.pressed,
            ]}
            onPress={() => navigateTab(key)}
          >
            <Icon color={selected ? colors.green : wide ? colors.ink : colors.muted} />
            <Text
              style={
                wide
                  ? { fontSize: 15, fontWeight: selected ? '700' : '500', color: colors.ink }
                  : [styles.tabLabel, selected && mobileStyles.navTextSelected]
              }
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const topBar = (
    <>
      <StatusBar barStyle="dark-content" {...{ backgroundColor: colors.navy }} />
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Walkup, home"
          onPress={() => navigateTab('home')}
          style={({ pressed }) => [styles.brand, pressed && styles.pressed]}
        >
          <BrandMark />
          <Text style={styles.brandText}>walkup</Text>
        </Pressable>
        {wide && navigation}
        {member ? (
          wide ? null : (
            <View />
          )
        ) : (
          // Visitors use everything; an account is one tap away for saving and alerts.
          <Pressable
            accessibilityRole="button"
            onPress={() => navigateTab('more')}
            style={({ pressed }) => [
              { borderWidth: 1, borderColor: colors.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
              pressed && styles.pressed,
            ]}
          >
            <Text style={{ fontWeight: '600', color: colors.ink }}>Log in</Text>
          </Pressable>
        )}
      </View>
    </>
  );

  // A server that still asks everyone to sign in: only the sign-in form.
  if (serverState === 'locked')
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        <AccountPrompt reason="use Walkup" onSignedIn={signedIn} />
      </SafeAreaView>
    );

  return (
    <StreetViewContext.Provider value={streetViewAvailable}>
      <SafeAreaView style={styles.safe}>
        {topBar}
        {(view === 'results' || view === 'saved') && (
          <View style={mobileStyles.searchBar}>
            {/* The search pill: where, and for what. On Search it opens the filters. */}
            <Pressable
              accessibilityRole={view === 'results' ? 'button' : undefined}
              accessibilityLabel={view === 'results' ? 'Edit search: ' + marketArea : undefined}
              disabled={view !== 'results'}
              onPress={() => toggleFilter('more')}
              style={mobileStyles.summary}
            >
              {view === 'results' ? <SearchIcon color={colors.ink} size={18} /> : <HeartIcon color={colors.green} size={18} filled />}
              <View style={mobileStyles.summaryCopy}>
                <Text numberOfLines={1} style={mobileStyles.summaryTitle}>
                  {view === 'saved' ? 'Your saved apartments' : marketArea}
                </Text>
                <Text numberOfLines={1} style={mobileStyles.destinationText}>
                  {view === 'saved'
                    ? 'Saved on this device'
                    : bedroomLabel(applied.bedrooms) +
                      ' · ' +
                      (applied.maxRent == null ? 'Any price' : 'Up to ' + formatRent(applied.maxRent))}
                </Text>
              </View>
            </Pressable>
            {view === 'results' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filters"
                onPress={() => toggleFilter('more')}
                style={({ pressed }) => [mobileStyles.iconButton, pressed && styles.pressed]}
              >
                <SlidersIcon color={colors.ink} />
              </Pressable>
            )}
          </View>
        )}
        {view === 'results' && (
          <View style={{ paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <CategoryBar
              applied={applied}
              onChoose={(changes) => {
                const next = { ...draft, ...changes };
                setDraft(next);
                void submit(next);
              }}
            />
          </View>
        )}
        <Modal visible={Boolean(expanded)} transparent animationType="slide" onRequestClose={() => setExpanded('')}>
          <View style={[mobileStyles.overlay, wide && mobileStyles.overlayCentered]}>
            <View style={[mobileStyles.sheet, wide && mobileStyles.wideSheet]} accessibilityViewIsModal>
              <View style={mobileStyles.sheetHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  onPress={() => setExpanded('')}
                  style={({ pressed }) => [mobileStyles.sheetClose, pressed && styles.pressed]}
                >
                  <CloseIcon color={colors.ink} />
                </Pressable>
                <Text accessibilityRole="header" style={mobileStyles.sheetTitle}>
                  {expanded === 'commute' ? 'Commute destination' : 'Filters'}
                </Text>
                <View style={mobileStyles.sheetClose} />
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
                  describe={(changes) => {
                    const next = { ...draft, ...changes };
                    setDraft(next);
                    void submit(next);
                  }}
                  loadNeighborhoods={serverState === 'ready' ? loadNeighborhoods : undefined}
                  busy={busy}
                  serverState={serverState}
                  commuteConfigured={commuteConfigured}
                  connect={connect}
                  lookUp={serverState === 'ready' ? (place) => api('geocode', { body: { address: place }, token: activeToken }) : undefined}
                  websites={
                    <WebsiteFilter
                      result={result}
                      applied={draft}
                      onSelect={(source) => setDraft((current) => ({ ...current, source }))}
                      onError={setError}
                      configuredSources={configuredSources}
                    />
                  }
                />
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
                {/* Pages opened from Profile say where they came from and lead back to it. */}
                {PROFILE_PAGES.includes(view) && (
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel="Back to Profile"
                    onPress={() => navigateTab('more')}
                    style={({ pressed }) => [{ alignSelf: 'flex-start', paddingVertical: 6 }, pressed && styles.pressed]}
                  >
                    <Text style={[styles.linkText, { fontSize: 15 }]}>‹ Profile</Text>
                  </Pressable>
                )}
                {(view === 'results' || view === 'saved') && (
                  <>
                    {
                      <View style={styles.toolbar}>
                        {!(view === 'saved' && saved.length === 0) ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Change destination"
                            disabled={busy}
                            onPress={() => {
                              setError('');
                              toggleFilter('commute');
                            }}
                            style={{ flexShrink: 1, paddingVertical: 6 }}
                          >
                            <Text numberOfLines={1} style={mobileStyles.destinationText}>
                              Commute times to <Text style={{ color: colors.ink, fontWeight: '600' }}>{result.workplace.label}</Text> ·{' '}
                              <Text style={styles.linkText}>Change</Text>
                            </Text>
                          </Pressable>
                        ) : (
                          <View />
                        )}
                        <View style={[styles.chipRow, { flexShrink: 1 }]}>
                          {TOOLS[view]
                            .filter(([id]) => id !== 'changes' || !staleInventory)
                            .filter(() => view !== 'saved' || saved.length > 0)
                            .map(([id, short, full]) => (
                              <Chip key={id} label={full} selected={tool === id} onPress={() => setTool(tool === id ? '' : id)}>
                                {short}
                              </Chip>
                            ))}
                        </View>
                      </View>
                    }
                    {view === 'saved' && <SavedComparison listings={saved} open={tool === 'compare'} />}
                    {view === 'saved' && <TourPlanner listings={saved} open={tool === 'tours'} />}
                    {view === 'results' && (
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
                    {view === 'results' && !staleInventory && <ObservedChanges listings={result.matches} open={tool === 'changes'} />}
                    {view === 'results' && staleInventory && (
                      <View style={styles.empty}>
                        <Text accessibilityRole="header" style={styles.panelTitle}>
                          These results need a fresh check
                        </Text>
                        <Text style={styles.bodyText}>
                          Their source freshness window has expired. The old results and map are hidden rather than presented as current
                          availability. Search again to read the server’s cached inventory, or review source status. No provider refresh
                          runs automatically from this notice.
                        </Text>
                        <Button secondary onPress={() => navigateTab('sources')}>
                          Review source status
                        </Button>
                      </View>
                    )}
                    {(view === 'saved' || !staleInventory) && (
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
                              columns={split ? 1 : width >= 1200 ? 3 : wide ? 2 : 1}
                              savedByKey={savedByKey}
                              showMarkets={() => navigateTab('marketplaces')}
                              showSources={() => navigateTab('sources')}
                              onAlert={() => navigateTab('alerts')}
                              onSave={saveListing}
                              onSaveLink={saveLink}
                              onRemove={(listing) =>
                                setSaved((current) => current.filter((item) => listingKey(item) !== listingKey(listing)))
                              }
                              onError={setError}
                              status={
                                view === 'results' ? (
                                  <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={freshness + ' · Where listings come from'}
                                    onPress={() => navigateTab('sources')}
                                  >
                                    <Text style={styles.smallMuted}>
                                      {freshness} · <Text style={styles.linkText}>Where listings come from</Text>
                                    </Text>
                                  </Pressable>
                                ) : undefined
                              }
                            />
                          </View>
                        )}
                        {WEB_MAP && mapView && (
                          <View style={[styles.mapPanel, split && styles.mapPanelWide]}>
                            <Suspense fallback={<Text style={styles.smallMuted}>Loading map…</Text>}>
                              <ListingMap
                                points={points}
                                total={displayed.total}
                                visible
                                onSave={(point) => saveListing(mapListing(point, displayed.matches))}
                                isSaved={(point) => savedKeys.has(listingKey(mapListing(point, displayed.matches)))}
                              />
                            </Suspense>
                          </View>
                        )}
                      </View>
                    )}
                  </>
                )}
                {view === 'more' && (
                  <ProfilePage
                    account={account}
                    admin={admin}
                    plan={plan}
                    billingRequest={serverState === 'ready' && account ? billingRequest : undefined}
                    accountRequest={serverState === 'ready' && account ? accountRequest : undefined}
                    membersRequest={serverState === 'ready' ? membersRequest : undefined}
                    savedCount={savedResults.total}
                    onOpen={navigateTab}
                    onSignOut={() => void signOut()}
                    signInCard={member ? undefined : <AccountPrompt reason="save apartments and get alerts" onSignedIn={signedIn} />}
                    settingsRequest={serverState === 'ready' ? settingsRequest : undefined}
                    onError={setError}
                  />
                )}
                {view === 'chart' && (
                  <RentChart
                    initialRegion={applied.region}
                    saved={saved}
                    showSaved={showSaved}
                    onError={setError}
                    loadMarket={serverState === 'ready' ? loadMarket : undefined}
                    loadHistory={serverState === 'ready' && dashboardAvailable ? loadHistory : undefined}
                  />
                )}
                {view === 'sources' && (
                  <>
                    <Text accessibilityRole="header" style={styles.panelTitle}>
                      Sources & sync
                    </Text>
                    {refreshError !== '' && (
                      <Text accessibilityRole="alert" style={styles.noticeLine}>
                        {refreshError}
                      </Text>
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
                {view === 'marketplaces' && (
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
                {view === 'alerts' && (
                  <AlertsPage
                    request={alertRequest}
                    filters={applied}
                    loadNeighborhoods={serverState === 'ready' ? loadNeighborhoods : undefined}
                    onError={setError}
                  />
                )}
                {view === 'shared' && (
                  <SharedListPage
                    request={serverState === 'ready' && account ? householdRequest : undefined}
                    saved={saved}
                    lookUp={
                      serverState === 'ready' ? (place) => api('geocode', { body: { address: place }, token: activeToken }) : undefined
                    }
                    onError={setError}
                  />
                )}
                {view === 'apply' && <ApplyPage saved={saved} onError={setError} />}
                {view === 'home' && (
                  <HomePage
                    signedIn={member}
                    onOpen={navigateTab}
                    onDone={(changes, alerts) => {
                      const next = { ...draft, ...changes };
                      setDraft(next);
                      navigateTab('results');
                      void submit(next).then(() => {
                        if (alerts) navigateTab('alerts');
                      });
                    }}
                  />
                )}
                {view === 'account' && <AccountPrompt reason={ACCOUNT_TABS[tab] ?? 'save apartments'} onSignedIn={signedIn} />}
                {view.startsWith('listing=') && (
                  <ListingPage
                    id={decodeURIComponent(view.slice('listing='.length))}
                    load={serverState === 'ready' ? loadListing : undefined}
                    workplace={result.workplace}
                    saved={(listing) => savedByKey.has(listingKey(listing))}
                    onSave={saveListing}
                    onSaveLink={saveLink}
                    onBack={() => navigateTab('results')}
                    onError={setError}
                  />
                )}
                {view === 'admin' && <AdminPage load={serverState === 'ready' && admin ? loadAdminStats : undefined} onError={setError} />}
                {view === 'list' && (
                  <DirectPage
                    request={serverState === 'ready' && account ? directRequest : undefined}
                    account={account}
                    onError={setError}
                  />
                )}
                {view === 'afford' && (
                  <AffordPage
                    onSearch={(maxRent) => {
                      const next = { ...draft, maxRent };
                      setDraft(next);
                      void submit(next);
                    }}
                  />
                )}
                {view === 'terms' && <LegalPage kind="terms" />}
                {view === 'privacy' && <LegalPage kind="privacy" />}
                {view === 'neighborhoods' && (
                  <NeighborhoodsPage
                    loadNeighborhoods={serverState === 'ready' ? loadNeighborhoods : undefined}
                    loadReport={serverState === 'ready' ? loadNeighborhoodReport : undefined}
                    onError={setError}
                    onShow={(neighborhood, borough) => {
                      const next = { ...draft, neighborhood, region: (borough && boroughKey(borough)) || 'nyc', zip: '' };
                      setDraft(next);
                      void submit(next);
                    }}
                  />
                )}
                {view === 'renewal' && (
                  <RenewalPage
                    loadNeighborhoods={serverState === 'ready' ? loadNeighborhoods : undefined}
                    loadReport={serverState === 'ready' ? loadNeighborhoodReport : undefined}
                    onError={setError}
                  />
                )}
                {view === 'affordable' && (
                  <AffordableHousing
                    region={applied.region}
                    loadHousing={serverState === 'ready' ? loadHousing : undefined}
                    onError={setError}
                  />
                )}
              </Suspense>
            </View>
            <View style={styles.footer}>
              <Text style={styles.smallMuted}>Walkup · New York, New Jersey and Connecticut</Text>
            </View>
          </View>
        </ScrollView>
        {/* Map and list switch from a floating pill above the tab bar. */}
        {WEB_MAP && (view === 'results' || (view === 'saved' && saved.length > 0)) && (
          <View pointerEvents="box-none" style={mobileStyles.floatingRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mapView ? 'List' : 'Map'}
              onPress={() => setMapView(!mapView)}
              style={({ pressed }) => [mobileStyles.floatingPill, pressed && styles.pressed]}
            >
              <Text style={mobileStyles.floatingText}>{mapView ? 'Show list' : 'Show map'}</Text>
              {mapView ? <ListIcon color={colors.white} /> : <MapIcon color={colors.white} />}
            </Pressable>
          </View>
        )}
        {toast !== '' && (
          <View pointerEvents="box-none" style={[mobileStyles.floatingRow, { bottom: 150 }]}>
            <View
              accessibilityRole="alert"
              style={[mobileStyles.floatingPill, { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, gap: 16 }]}
            >
              <Text style={{ color: colors.ink, fontWeight: '600' }}>{toast}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setToast('');
                  showSaved();
                }}
              >
                <Text style={[styles.linkText, { fontWeight: '600' }]}>View</Text>
              </Pressable>
            </View>
          </View>
        )}
        {!wide && <View style={mobileStyles.bottomNav}>{navigation}</View>}
      </SafeAreaView>
    </StreetViewContext.Provider>
  );
}

/** Pages opened from Profile, which lead back to it. */
const PROFILE_PAGES = [
  'afford',
  'apply',
  'alerts',
  'shared',
  'list',
  'neighborhoods',
  'renewal',
  'affordable',
  'marketplaces',
  'sources',
  'admin',
  'terms',
  'privacy',
];
/** Each screen's name in the browser tab and history. */
const PAGE_TITLES: Record<string, string> = {
  home: 'Walkup · New York City apartments',
  results: 'Search',
  chart: 'Rent prices',
  saved: 'Saved apartments',
  more: 'Profile',
  afford: 'What can I afford?',
  apply: 'Application kit',
  alerts: 'Email alerts',
  shared: 'Shared list',
  list: 'List your apartment',
  neighborhoods: 'Neighborhoods',
  renewal: 'Renewal check',
  affordable: 'Affordable housing',
  marketplaces: 'Rental platforms',
  sources: 'Sources & sync',
  admin: 'Dashboard',
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
};

/** Screens that belong to an account, and what a visitor is asked to create one for. */
const ACCOUNT_TABS: Record<string, string> = {
  saved: 'save apartments',
  alerts: 'get email alerts',
  shared: 'share a list',
  list: 'list your apartment',
};

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
