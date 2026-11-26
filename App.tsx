import { searchAvailabilityMessage } from './src/search-availability.ts';
import { ErrorBoundary } from './src/components/ErrorBoundary.tsx';
import { useAccountSaved, useHashNavigation, useInventoryClock, useSavedListings } from './src/hooks/app-hooks.ts';
import { inventoryExpired } from './src/inventory-freshness.ts';
import type { ListingData, SourceLink, SearchResult } from './src/domain.ts';

import { Modal, Platform, Pressable, ScrollView, StatusBar, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { REGIONS, boroughKey } from './src/regions.ts';
import { bedroomsLabel, formatRent, localWorkplace, needsCommute, parseFilters } from './src/search.ts';
import { mobileStyles } from './src/mobileStyles.ts';
import { colors, styles } from './src/styles.ts';
import { localSearch } from './src/market.ts';
import { listingKey, mapListing, mergeListings, mergeSourceLinks } from './src/listings.ts';
import { AlertButton, Button, Chip, ExternalLink } from './src/components/ui.tsx';
import { startVitals } from './src/web-vitals-report.ts';
import { SavedSearches } from './src/components/SavedSearches.tsx';
import { ObservedChanges } from './src/components/ObservedChanges.tsx';
import {
  API_ORIGIN,
  failureInfo,
  WEB_MAP,
  SEARCH_DEFAULTS,
  PAGE_SIZE,
  TOOLS,
  EMPTY_POINTS,
  SAVED_FILTERS,
  formDefaults,
  api,
  searchApartments,
} from './src/app-shared.ts';
import { Filters } from './src/components/Filters.tsx';
import { HomePage } from './src/screens/HomePage.tsx';
import { AccountPrompt } from './src/components/AccountPrompt.tsx';
import { StreetViewContext } from './src/components/ListingThumbnail.tsx';
// No extension: the bundler picks liberty-snapshot.web.tsx in the browser and the stub elsewhere.
import { warmSnapshots } from './src/components/liberty-snapshot';
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
  TicketIcon,
} from './src/components/Icons.tsx';
import { Marketplaces } from './src/screens/Marketplaces.tsx';
import { Results } from './src/screens/Results.tsx';
import { CommuteCard } from './src/components/CommuteCard.tsx';
import { CommuteContext } from './src/components/commute-context.ts';
import { HiddenContext, useHidden } from './src/hooks/use-hidden.ts';
import { useCommutePlace } from './src/hooks/use-commute-place.ts';
import { useServer } from './src/hooks/use-server.ts';
import { preloadable, preloadScreens } from './src/preloadable.tsx';
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Screens off the first page load: downloaded while the app is idle (or on first use), so opening the app
// downloads only what search needs and later screens open at once (src/preloadable.tsx).
const ListingMap = preloadable(() => import('./src/components/ListingMap').then((module) => module.ListingMap));
const AffordableHousing = preloadable(() => import('./src/screens/AffordableHousing.tsx').then((module) => module.AffordableHousing));
const SourcesPage = preloadable(() => import('./src/screens/SourcesPage.tsx').then((module) => module.SourcesPage));
const SavedComparison = preloadable(() => import('./src/components/SavedComparison.tsx').then((module) => module.SavedComparison));
const TourPlanner = preloadable(() => import('./src/components/TourPlanner.tsx').then((module) => module.TourPlanner));
const RentChart = preloadable(() => import('./src/components/RentChart.tsx').then((module) => module.RentChart), 'soon');
const ProfilePage = preloadable(() => import('./src/screens/ProfilePage.tsx').then((module) => module.ProfilePage), 'soon');
const SharedLinkPage = preloadable(() => import('./src/screens/SharedLinkPage.tsx').then((module) => module.SharedLinkPage));
const SharedListPage = preloadable(() => import('./src/screens/SharedListPage.tsx').then((module) => module.SharedListPage));
const ApplyPage = preloadable(() => import('./src/screens/ApplyPage.tsx').then((module) => module.ApplyPage));
const NeighborhoodsPage = preloadable(() => import('./src/screens/NeighborhoodsPage.tsx').then((module) => module.NeighborhoodsPage));
const RenewalPage = preloadable(() => import('./src/screens/NeighborhoodsPage.tsx').then((module) => module.RenewalPage));
const AdminPage = preloadable(() => import('./src/screens/AdminPage.tsx').then((module) => module.AdminPage));
const AboutPage = preloadable(() => import('./src/screens/AboutPage.tsx').then((module) => module.AboutPage));
const PricingPage = preloadable(() => import('./src/screens/AboutPage.tsx').then((module) => module.PricingPage));
const LegalPage = preloadable(() => import('./src/screens/LegalPage.tsx').then((module) => module.LegalPage));
const ListingPage = preloadable(() => import('./src/screens/ListingPage.tsx').then((module) => module.ListingPage));
const DirectPage = preloadable(() => import('./src/screens/DirectPage.tsx').then((module) => module.DirectPage));
const AffordPage = preloadable(() => import('./src/screens/AffordPage.tsx').then((module) => module.AffordPage));
const AlertsPage = preloadable(() => import('./src/screens/AlertsPage.tsx').then((module) => module.AlertsPage));

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
  const serverStateRef = useRef('checking');
  const activeTokenRef = useRef<string | undefined>(undefined);
  const { tab, navigateTab, scope, setScope, expanded, setExpanded } = useHashNavigation();
  /** The open tool panel below the commute box: one at a time. */
  const [tool, setTool] = useState('');
  const [mapView, setMapView] = useState(false);
  const searchAbort = useRef<AbortController | null>(null);
  /** The apartment opened from the results, shown on its page at once. */
  const [openedListing, setOpenedListing] = useState<ListingData | null>(null);
  function openListing(listing: ListingData) {
    setOpenedListing(listing);
    navigateTab('listing=' + encodeURIComponent(listing.id));
  }
  const recentSearches = useRef(new Map<string, { at: number; result: SearchResult }>());
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
  /** A new search (not the next page) is on its way. */
  const [searching, setSearching] = useState(false);
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
    sharedLinkRequest,
    billingRequest,
    loadListing,
    loadStoredListing,
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
    commutePlaceRequest,
    settingsRequest,
    loadHousing,
    checkBuilding,
  } = useServer({ appliedFilters, searchVersion, submitted, setResult, setError });
  const suggestPlaces = useMemo(
    () =>
      serverState === 'ready'
        ? (query: string) =>
            api<{ places: { label: string; latitude: number; longitude: number }[] }>('places', {
              body: { query },
              token: activeToken,
            }).then(({ places }) => places)
        : undefined,
    [serverState, activeToken],
  );
  useAccountSaved(saved, setSaved, account, serverState === 'ready' ? savedRequest : undefined, setError);
  // An apartment's own page, with its estimated transit time to the destination searches use.
  const loadListingWithCommute = useCallback(
    (id: string) => loadListing(id, { workplace: applied.workplace, customWorkplace: applied.customWorkplace }),
    [loadListing, applied.workplace, applied.customWorkplace],
  );
  // Where the person commutes to, from their account (or this device): every new search starts from it.
  const commute = useCommutePlace(account, serverState === 'ready' && account ? commutePlaceRequest : undefined, (place) => {
    setDraft((current) => ({ ...current, ...place }));
    // The results shown are for the saved destination: searched again with it if they were for another.
    const shown = appliedFilters.current;
    if (shown.workplace === place.workplace && shown.customWorkplace === place.customWorkplace) return;
    const filters = parseFilters({ ...shown, ...place });
    appliedFilters.current = filters;
    setApplied(filters);
    if (serverStateRef.current !== 'ready') return;
    const version = ++searchVersion.current;
    searchApartments(filters, { token: activeTokenRef.current })
      .then((fresh) => version === searchVersion.current && setResult(fresh))
      .catch(() => {});
  });
  serverStateRef.current = serverState;
  // Until the person says where they work, commute times ask for it rather than measure to a stand-in place.
  const navigateRef = useRef(navigateTab);
  navigateRef.current = navigateTab;
  const commuteKnown = commute.place !== null;
  /** Takes someone who has not said where they work to where they can (set below, once the screens are known). */
  const askCommute = useRef(() => {});
  const commuteAsk = useMemo(() => ({ known: commuteKnown, add: () => askCommute.current() }), [commuteKnown]);
  activeTokenRef.current = activeToken;
  const defaults = () => ({ ...formDefaults(), ...commute.current.current });
  const savedByKey = useMemo(() => new Map(saved.map((listing) => [listingKey(listing), listing])), [saved]);
  const savedResults = useMemo(() => localSearch(saved, SAVED_FILTERS, result.workplace, 'saved'), [saved, result.workplace]);

  /** A search asked for while the app was still connecting. */
  const waitingSearch = useRef<[typeof draft | typeof applied, boolean] | null>(null);
  useEffect(() => {
    const waiting = waitingSearch.current;
    if (!waiting || serverState === 'checking') return;
    waitingSearch.current = null;
    setBusy(false);
    // Connected: run it. Offline or signed out: say so, as a search made now would.
    void submit(...waiting);
  }, [serverState]);
  async function submit(nextDraft: typeof draft | typeof applied = draft, withMap = mapView) {
    // A search made in the first moment, before the server has answered, is held and run when it has
    // (the effect below), rather than refused with a message to try again.
    if (serverState === 'checking') {
      waitingSearch.current = [nextDraft, withMap];
      setError('');
      setBusy(true);
      return;
    }
    const unavailable = searchAvailabilityMessage(serverState);
    if (unavailable) {
      setError(unavailable);
      return;
    }
    submitted.current = true;
    // A new search replaces one still running (a second category tap is never ignored), and only the latest
    // one's answer is shown.
    const version = ++searchVersion.current;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setError('');
    setBusy(true);
    setSearching(true);
    const changingDestination = nextDraft.workplace !== applied.workplace || nextDraft.customWorkplace !== applied.customWorkplace;
    const previous = applied;
    try {
      // The map's points are asked for only while the map is showing; for every listing they are most of the answer.
      const filters = parseFilters({ ...nextDraft, liveOnly: true, includeCommute: commuteConfigured, includeMap: WEB_MAP && withMap });
      if (needsCommute(filters) && serverState !== 'ready') {
        setExpanded('commute');
        throw new Error('Commute estimates need the online search server. Try again when it is available.');
      }
      if (needsCommute(filters) && !commuteConfigured) {
        setExpanded('commute');
        throw new Error('Automatic commute estimates are currently unavailable.');
      }
      // The chosen category or filter shows as chosen at once, and the results screen opens while they load.
      setApplied(filters);
      // A destination applied for the first time is theirs from then on, even when it is the one first offered.
      if (changingDestination || (expanded === 'commute' && !commuteKnown))
        commute.remember({ workplace: filters.workplace, customWorkplace: filters.customWorkplace });
      setScope('market');
      navigateTab('results');
      setExpanded('');
      const key = JSON.stringify(filters);
      const recent = recentSearches.current.get(key);
      // Going back to a search from the last 15 minutes (All, then Deals, then All) shows its results at once.
      const searchResult =
        recent && Date.now() - recent.at < RECENT_SEARCH_MS
          ? recent.result
          : await searchApartments(filters, { token: activeToken, signal: controller.signal });
      if (version !== searchVersion.current) return;
      recentSearches.current.delete(key);
      recentSearches.current.set(key, { at: recent?.result === searchResult ? recent.at : Date.now(), result: searchResult });
      if (recentSearches.current.size > RECENT_SEARCHES) recentSearches.current.delete(recentSearches.current.keys().next().value!);
      appliedFilters.current = filters;
      setResult(searchResult);
    } catch (caught) {
      // A search replaced by a newer one is not an error.
      if (version !== searchVersion.current) return;
      setApplied(previous);
      const failure = failureInfo(caught);
      if (failure.commuteError) setExpanded('commute');
      setError(
        (failure.message || 'Search could not be completed.') +
          (changingDestination ? ' Destination was not changed; previous results are still shown.' : ''),
      );
    } finally {
      if (version === searchVersion.current) {
        setBusy(false);
        setSearching(false);
      }
    }
  }

  async function fetchPage(offset: number) {
    if (busy || serverState !== 'ready') return;
    const version = ++searchVersion.current;
    const filters = appliedFilters.current;
    setBusy(true);
    setError('');
    try {
      const page = await searchApartments({ ...filters, offset }, { token: activeToken });
      if (searchVersion.current === version && appliedFilters.current === filters) setResult(page);
    } catch (caught) {
      const failure = failureInfo(caught);
      setError(failure.message || 'Could not load the next page.');
    } finally {
      setBusy(false);
    }
  }

  function searchCompany(company: string) {
    const nextDraft = { ...defaults(), company, bedrooms: null, maxRent: '' };
    setDraft(nextDraft);
    void submit(nextDraft);
  }

  /** The commute limit from the results bar: a new search with it, everything else kept. */
  function selectCommute(minutes: number | null) {
    if ((applied.maxCommuteMinutes ?? null) === minutes) return;
    setDraft((current) => ({ ...current, maxCommuteMinutes: minutes }));
    void submit({ ...applied, maxCommuteMinutes: minutes });
  }

  function selectSort(sort: string) {
    if (busy || sort === applied.sort) return;
    setDraft((current) => ({ ...current, sort }));
    void submit({ ...applied, sort });
  }

  const hiding = useHidden();
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

  // A message belongs to the screen it was shown on; going to another one clears it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the screen changes.
  useEffect(() => setError(''), [tab]);

  // The browser tab names the screen, so tabs and history are told apart.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const title = tab.startsWith('listing=') ? 'Apartment' : (PAGE_TITLES[tab] ?? 'Walkup');
    document.title = tab === 'home' ? title : `${title} · Walkup`;
  }, [tab]);

  // The screens people open most are downloaded while the app is idle, so their first visit does not wait.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // The main screens first; the map and the rest a few seconds later, and not at all on a data-saving or
    // very slow connection, where they load when opened.
    const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const thrifty = connection?.saveData === true || /2g/.test(connection?.effectiveType ?? '');
    const idle = (run: () => void) => {
      const request = (globalThis as { requestIdleCallback?: (run: () => void) => number }).requestIdleCallback;
      if (request) request(run);
      else setTimeout(run, 1500);
    };
    idle(() => void preloadScreens('soon'));
    if (thrifty) return;
    // The hidden map that draws each card's picture: started now where the page opens on cards, so the first
    // picture does not wait for the map's code and style after the card is on screen; elsewhere with the rest.
    const cardsFirst = /^\/(search|saved|listing\/)/.test(window.location.pathname);
    if (cardsFirst) warmSnapshots();
    const later = setTimeout(
      () =>
        idle(() => {
          void preloadScreens('later');
          warmSnapshots();
        }),
      6000,
    );
    return () => clearTimeout(later);
  }, []);

  // Rents, the tab people open after searching, is built hidden a moment after the app is ready (below), on the
  // web and not on a data-saving or very slow connection.
  const [rentsReady, setRentsReady] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || serverState !== 'ready' || rentsReady) return;
    const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData === true || /2g/.test(connection?.effectiveType ?? '')) return;
    const timer = setTimeout(() => setRentsReady(true), 1200);
    return () => clearTimeout(timer);
  }, [serverState, rentsReady]);

  // A visitor (no account, not the app's own admin token) uses everything except what belongs to an account.
  const member = Boolean(account) || admin;
  const view = !member && ACCOUNT_TABS[tab] ? 'account' : tab;
  // Why a visitor's profile is showing the sign-in page instead ('' when it is not); leaving the profile ends it.
  const [signInReason, setSignInReason] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: cleared whenever the screen changes
  useEffect(() => setSignInReason(''), [tab]);
  // A member sets the destination on their profile, where it is kept with the account; a visitor in the
  // search's own destination box, where nothing claims to be saved.
  askCommute.current = () => {
    if (member) return navigateTab('more');
    navigateTab('results');
    setError('');
    if (expanded !== 'commute') toggleFilter('commute');
  };
  const listMode = view === 'results' || view === 'saved';
  const [listMounted, setListMounted] = useState(listMode);
  if (listMode && !listMounted) setListMounted(true);

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
          ['affordable', 'Lotteries', TicketIcon],
          ['saved', `Saved (${savedResults.total})`, HeartIcon],
          // The same place for everyone: a visitor signs in there, a member finds their profile.
          ['more', member ? 'Profile' : 'Log in', ProfileIcon],
        ] as const
      ).map(([key, label, Icon]) => {
        // An apartment's page belongs to Search; Profile's own pages to Profile.
        const selected =
          key === 'more'
            ? !['home', 'chart', 'results', 'saved', 'affordable', 'about', 'pricing'].includes(tab) && !/^(listing|link)=/.test(tab)
            : key === 'results'
              ? tab === key || tab.startsWith('listing=')
              : tab === key;
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
                wide ? { fontSize: 15, fontWeight: '600', color: colors.ink } : [styles.tabLabel, selected && mobileStyles.navTextSelected]
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
          // A visitor's header has the one page they ask for before signing up; "Log in" is with the other tabs.
          <Pressable
            accessibilityRole="link"
            onPress={() => navigateTab('pricing')}
            style={({ pressed }) => [{ paddingHorizontal: 8, paddingVertical: 8 }, pressed && styles.pressed]}
          >
            <Text style={{ fontWeight: '600', color: colors.ink }}>Pricing</Text>
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
      <CommuteContext.Provider value={commuteAsk}>
        <HiddenContext.Provider value={hiding}>
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
                        ? account
                          ? 'Kept on your account'
                          : 'Saved on this device'
                        : bedroomsLabel(applied) + ' · ' + (applied.maxRent == null ? 'Any price' : 'Up to ' + formatRent(applied.maxRent))}
                    </Text>
                  </View>
                </Pressable>
                {/* The call to action beside the search, as listing sites put "Save search"; on a phone it leads
                  the row under the search instead, where there is room for its words. */}
                {view === 'results' && wide && result.total > 0 && <AlertButton onPress={() => navigateTab('alerts')} />}
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
            <Modal
              visible={Boolean(expanded)}
              transparent
              // A sheet slides up on a phone; on a wide screen the centered dialog appears at once.
              animationType={wide ? 'fade' : 'slide'}
              onRequestClose={() => setExpanded('')}
            >
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
                      busy={busy}
                      serverState={serverState}
                      commuteConfigured={commuteConfigured}
                      connect={connect}
                      suggest={suggestPlaces}
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
              // Room under the last line for the floating map pill, so it never covers the footer.
              contentContainerStyle={[
                styles.scroll,
                WEB_MAP && (view === 'results' || (view === 'saved' && saved.length > 0)) && { paddingBottom: 88 },
              ]}
            >
              <View style={styles.shell}>
                <View style={styles.results}>
                  <Suspense fallback={<Text style={styles.smallMuted}>Loading…</Text>}>
                    {error !== '' && (
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                        <Text accessibilityRole="alert" style={[styles.error, { flex: 1 }]}>
                          {error}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Dismiss message"
                          onPress={() => setError('')}
                          hitSlop={8}
                          style={({ pressed }) => [{ padding: 6 }, pressed && styles.pressed]}
                        >
                          <Text style={{ fontSize: 18, color: colors.muted }}>×</Text>
                        </Pressable>
                      </View>
                    )}
                    {/* Pages opened from Profile say where they came from and lead back to it. */}
                    {PROFILE_PAGES.includes(tab) && (
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel="Back to Profile"
                        onPress={() => navigateTab('more')}
                        style={({ pressed }) => [{ alignSelf: 'flex-start', paddingVertical: 6 }, pressed && styles.pressed]}
                      >
                        <Text style={[styles.linkText, { fontSize: 15 }]}>‹ Profile</Text>
                      </Pressable>
                    )}
                    {listMounted && (
                      // Kept mounted after the first visit and hidden on other screens, so coming back to Search or Saved
                      // shows the cards at once instead of building them all again.
                      <View style={listMode ? undefined : { display: 'none' }}>
                        <>
                          {view === 'saved' && (
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
                                    Commute times to <Text style={{ color: colors.ink, fontWeight: '600' }}>{result.workplace.label}</Text>{' '}
                                    · <Text style={styles.linkText}>Change</Text>
                                  </Text>
                                </Pressable>
                              ) : (
                                <View />
                              )}
                              <View style={[styles.chipRow, { flexShrink: 1 }]}>
                                {TOOLS[view === 'saved' ? 'saved' : 'results']
                                  .filter(([id]) => id !== 'changes' || !staleInventory)
                                  .filter(() => view !== 'saved' || saved.length > 0)
                                  .map(([id, short, full]) => (
                                    <Chip key={id} label={full} selected={tool === id} onPress={() => setTool(tool === id ? '' : id)}>
                                      {short}
                                    </Chip>
                                  ))}
                              </View>
                            </View>
                          )}
                          {view === 'saved' && <SavedComparison listings={saved} open={tool === 'compare'} />}
                          {view === 'saved' && <TourPlanner listings={saved} open={tool === 'tours'} />}
                          {view === 'results' && (
                            <SavedSearches
                              open={tool === 'searches'}
                              filters={applied}
                              disabled={busy}
                              apply={(filters) => {
                                const next = { ...filters, includeMap: WEB_MAP && mapView };
                                setDraft({ ...defaults(), ...next });
                                void submit(next);
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
                                Their source freshness window has expired. The old results and map are hidden rather than presented as
                                current availability. Search again to read the server’s cached inventory, or review source status. No
                                provider refresh runs automatically from this notice.
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
                                    searching={searching}
                                    destination={
                                      view === 'results'
                                        ? commuteAsk.known
                                          ? {
                                              label: result.workplace.label,
                                              onChange: () => {
                                                setError('');
                                                toggleFilter('commute');
                                              },
                                            }
                                          : { label: '', onChange: commuteAsk.add }
                                        : undefined
                                    }
                                    tools={
                                      view === 'results'
                                        ? TOOLS.results
                                            .filter(([id]) => id !== 'changes' || !staleInventory)
                                            .map(([id, label]) => [id, label, tool === id] as [string, string, boolean])
                                        : []
                                    }
                                    onTool={(id) => setTool(tool === id ? '' : id)}
                                    onCheckBuilding={serverState === 'ready' ? checkBuilding : undefined}
                                    visible={visible}
                                    setVisible={setVisible}
                                    result={displayed}
                                    applied={applied}
                                    sort={scope === 'saved' ? SAVED_FILTERS.sort : applied.sort}
                                    onSort={selectSort}
                                    onCommute={view === 'results' ? (commuteAsk.known ? selectCommute : () => commuteAsk.add()) : undefined}
                                    onPage={fetchPage}
                                    paging={busy}
                                    openCommute={() => setExpanded('commute')}
                                    commuteConfigured={commuteConfigured}
                                    checkingInventory={refreshing || serverState === 'checking' || busy}
                                    columns={split ? 1 : width >= 1200 ? 3 : wide ? 2 : 1}
                                    savedByKey={savedByKey}
                                    showMarkets={() => navigateTab('marketplaces')}
                                    showSources={() => navigateTab('sources')}
                                    onAlert={wide ? undefined : () => navigateTab('alerts')}
                                    onOpen={openListing}
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
                                          style={{ flexShrink: 1 }}
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
                              {WEB_MAP && mapView && listMode && (
                                <View style={[styles.mapPanel, split && styles.mapPanelWide]}>
                                  <Suspense fallback={<Text style={styles.smallMuted}>Loading map…</Text>}>
                                    <ListingMap
                                      points={points}
                                      total={displayed.total}
                                      visible
                                      onSave={(point) => saveListing(mapListing(point, displayed.matches))}
                                      isSaved={(point) => savedKeys.has(listingKey(mapListing(point, displayed.matches)))}
                                      onOpen={(point) => openListing(mapListing(point, displayed.matches))}
                                    />
                                  </Suspense>
                                </View>
                              )}
                            </View>
                          )}
                        </>
                      </View>
                    )}
                    {/* "Sign in to save" on a visitor's profile opens the sign-in page, with the reason they asked. */}
                    {view === 'more' && !member && signInReason !== '' && <AccountPrompt reason={signInReason} onSignedIn={signedIn} />}
                    {view === 'more' && (member || signInReason === '') && (
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
                        // A visitor's destination is used for their searches at once, and the button says what
                        // keeping it takes: signing in, after which it is saved to the account.
                        commuteCard={
                          <CommuteCard
                            place={commute.place ?? { workplace: applied.workplace, customWorkplace: applied.customWorkplace }}
                            onAccount={Boolean(account)}
                            onSignIn={member ? undefined : () => setSignInReason('keep your commute on every device')}
                            suggest={suggestPlaces}
                            onSave={(place) => {
                              commute.remember(place);
                              setDraft((current) => ({ ...current, ...place }));
                            }}
                          />
                        }
                        settingsRequest={serverState === 'ready' ? settingsRequest : undefined}
                        onError={setError}
                      />
                    )}
                    {/* Rents is built in the background once the app is idle and kept, hidden, so the tab opens at
                      once with its data already read. A new search's area starts it again for that area. */}
                    {(view === 'chart' || rentsReady) && (
                      <View style={view === 'chart' ? undefined : { display: 'none' }}>
                        <Suspense fallback={view === 'chart' ? <Text style={styles.smallMuted}>Loading…</Text> : null}>
                          <RentChart
                            key={applied.region}
                            initialRegion={applied.region}
                            saved={saved}
                            showSaved={showSaved}
                            onError={setError}
                            loadMarket={serverState === 'ready' ? loadMarket : undefined}
                            loadHistory={serverState === 'ready' && dashboardAvailable ? loadHistory : undefined}
                          />
                        </Suspense>
                      </View>
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
                        onUpgrade={() => navigateTab('more')}
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
                        origin={Platform.OS === 'web' ? window.location.origin : API_ORIGIN}
                      />
                    )}
                    {/* A shared list opened by its link, by someone who may have no account. */}
                    {view.startsWith('link=') && (
                      <SharedLinkPage
                        key={view}
                        load={serverState === 'ready' ? () => sharedLinkRequest(view.slice('link='.length)) : undefined}
                        addNote={(note) => sharedLinkRequest(view.slice('link='.length), note)}
                        onOpenListing={openListing}
                        onSearch={() => navigateTab('results')}
                      />
                    )}
                    {view === 'apply' && <ApplyPage saved={saved} onError={setError} />}
                    {view === 'home' && (
                      <HomePage
                        onOpen={navigateTab}
                        // A search from the home page starts fresh, not from the filters of an earlier one.
                        onSearch={(changes) => {
                          const next = { ...defaults(), ...changes, maxRent: changes.maxRent == null ? '' : String(changes.maxRent) };
                          setDraft(next);
                          void submit(next);
                        }}
                        loadNeighborhoods={serverState === 'ready' ? loadNeighborhoods : undefined}
                      />
                    )}
                    {view === 'account' && <AccountPrompt reason={ACCOUNT_TABS[tab] ?? 'save apartments'} onSignedIn={signedIn} />}
                    {view.startsWith('listing=') && (
                      <ListingPage
                        id={decodeURIComponent(view.slice('listing='.length))}
                        load={serverState === 'ready' ? loadListingWithCommute : undefined}
                        loadStored={loadStoredListing}
                        workplace={result.workplace}
                        saved={(listing) => savedByKey.has(listingKey(listing))}
                        onSave={saveListing}
                        onSaveLink={saveLink}
                        initial={openedListing ?? undefined}
                        onCheckBuilding={serverState === 'ready' ? checkBuilding : undefined}
                        // Back to the results the apartment was opened from, where they were left; from a shared link, to search.
                        onBack={() => (openedListing && Platform.OS === 'web' ? window.history.back() : navigateTab('results'))}
                        onError={setError}
                      />
                    )}
                    {view === 'admin' && (
                      <AdminPage load={serverState === 'ready' && admin ? loadAdminStats : undefined} onError={setError} />
                    )}
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
                    {view === 'about' && <AboutPage onOpen={navigateTab} />}
                    {view === 'pricing' && <PricingPage signedIn={member} onOpen={navigateTab} />}
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
                  {/* What Walkup is and costs, and the monthly market reports, which are pages of their own written
                    from the same figures as the Rents tab. */}
                  <View style={[styles.chipRow, { alignItems: 'center' }]}>
                    <Pressable accessibilityRole="link" onPress={() => navigateTab('about')} style={{ paddingVertical: 6 }}>
                      <Text style={styles.linkText}>About</Text>
                    </Pressable>
                    <Text style={styles.smallMuted}>·</Text>
                    <Pressable accessibilityRole="link" onPress={() => navigateTab('pricing')} style={{ paddingVertical: 6 }}>
                      <Text style={styles.linkText}>Pricing</Text>
                    </Pressable>
                    <Text style={styles.smallMuted}>·</Text>
                    <ExternalLink url={`${API_ORIGIN}/blog`} onError={setError} style={{ paddingVertical: 6 }}>
                      <Text style={styles.linkText}>Market reports</Text>
                    </ExternalLink>
                  </View>
                </View>
              </View>
            </ScrollView>
            {/* Map and list switch from a floating pill above the tab bar. */}
            {WEB_MAP && (view === 'results' || (view === 'saved' && saved.length > 0)) && (
              <View pointerEvents="box-none" style={mobileStyles.floatingRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={mapView ? 'List' : 'Map'}
                  onPress={() => {
                    const showing = !mapView;
                    setMapView(showing);
                    // The search ran without the map's points; ask again with them.
                    if (showing && !result.mapPoints && scope !== 'saved') void submit(applied, true);
                  }}
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
                  style={[
                    mobileStyles.floatingPill,
                    { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, gap: 16 },
                  ]}
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
        </HiddenContext.Provider>
      </CommuteContext.Provider>
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
  affordable: 'Lotteries and public housing',
  marketplaces: 'Rental platforms',
  sources: 'Sources & sync',
  admin: 'Dashboard',
  about: 'How Walkup works',
  pricing: 'Pricing',
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

/**
 * Searches from the last 15 minutes, kept to show again at once when someone goes back to one. Listings change
 * every two hours at most during the day, so this is fresh enough, and the server keeps them as long.
 */
const RECENT_SEARCH_MS = 15 * 60_000;
const RECENT_SEARCHES = 8;

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
