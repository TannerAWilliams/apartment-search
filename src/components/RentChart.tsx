import type { ListingData } from '../domain.ts';
import type { RentArea, RentMarket, RentHistory } from '../rent-history.ts';
import type { LoadHistory } from '../screens/MarketHistory.tsx';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { formatSnapshotMonth, RENT_GROUPINGS, rentAreas, SNAPSHOT_MONTH, SNAPSHOT_SOURCE } from '../market.ts';
// Resolves to offline-rent-data.web.ts on the web, which bundles no data.
import { offlineRentData } from '../offline-rent-data';
import { NYC_SEARCH_AREAS, searchBorough } from '../regions.ts';
import { bedroomLabel, formatRent } from '../search.ts';
import { styles } from '../styles.ts';
import { Button, Chip, Field, Link, toggleProps } from './ui.tsx';
import { MarketHistory } from '../screens/MarketHistory.tsx';
import { RentTrend } from './RentTrend.tsx';

const SIZES = ['Studio', '1 BR', '2 BR', '3 BR', '4 BR'];
// One series (median rent by size), so one color for every bar.
const BAR_COLORS = ['#2a78d6', '#2a78d6', '#2a78d6', '#2a78d6', '#2a78d6'];
const GROUPINGS = Object.entries(RENT_GROUPINGS);
const PAGE_SIZE = 15;

function MedianBars({ area }: { area: RentArea }) {
  const largest = Math.max(1, ...area.sizes.map(({ median }) => median ?? 0));
  return (
    <View style={styles.chartCard}>
      <Text accessibilityRole="header" style={styles.panelTitle}>
        {area.label}
      </Text>
      <Text style={styles.smallMuted}>{[area.detail, `${area.count.toLocaleString('en-US')} listings`].filter(Boolean).join(' · ')}</Text>
      {area.sizes.map(({ median, count }, index) => (
        <View
          key={SIZES[index]}
          style={styles.barRow}
          accessibilityLabel={`${bedroomLabel(index)}, ${median === null ? 'no observations' : formatRent(median) + ' median asking rent, ' + count + ' listings'}`}
        >
          <Text style={styles.barLabel}>{SIZES[index]}</Text>
          <View style={styles.barTrack}>
            {median !== null && (
              <View style={[styles.barFill, { width: `${(median / largest) * 100}%`, backgroundColor: BAR_COLORS[index] }]} />
            )}
          </View>
          <View style={styles.barValue}>
            <Text style={styles.chartPrice}>{median === null ? '—' : formatRent(median)}</Text>
            <Text style={styles.chartCount}>{count === 0 ? 'No data' : `n = ${count}`}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function RentTable({ areas, selection, choose }: { areas: RentArea[]; selection: string; choose: (id: string) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      keyboardShouldPersistTaps="handled"
      accessibilityLabel="Median asking rent table, swipe horizontally for more bedroom sizes"
    >
      <View style={styles.chartTable}>
        <View style={styles.chartTableHeader}>
          <Text style={[styles.chartTablePlace, styles.fieldLabel]}>Area</Text>
          {SIZES.map((label) => (
            <Text key={label} style={[styles.chartCell, styles.fieldLabel]}>
              {label}
            </Text>
          ))}
        </View>
        {areas.map((area) => (
          <Pressable
            key={area.id}
            accessibilityRole="button"
            {...toggleProps(selection === area.id)}
            accessibilityLabel={`Show chart for ${area.label} ${area.detail}`}
            onPress={() => choose(area.id)}
            style={[styles.chartTableRow, selection === area.id && styles.chartTableSelected]}
          >
            <View style={styles.chartTablePlace}>
              <Text style={styles.fieldLabel}>{area.label}</Text>
              {area.detail !== '' && <Text style={styles.chartCount}>{area.detail}</Text>}
            </View>
            {area.sizes.map(({ median, count }, index) => (
              <View key={SIZES[index]} style={styles.chartCell}>
                <Text style={styles.chartPrice}>{median === null ? '—' : formatRent(median)}</Text>
                <Text style={styles.chartCount}>{count === 0 ? ' ' : `n = ${count}`}</Text>
              </View>
            ))}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

export function RentChart({
  initialRegion,
  saved,
  onError,
  showSaved,
  loadMarket,
  loadHistory,
}: {
  initialRegion: string;
  saved: ListingData[];
  onError: (message: string) => void;
  showSaved: () => void;
  loadMarket?: (region: string, grouping: string, signal: AbortSignal) => Promise<RentMarket>;
  loadHistory?: LoadHistory;
}) {
  const [dataset, setDataset] = useState('market');
  const [region, setRegion] = useState(initialRegion);
  const [grouping, setGrouping] = useState('neighborhood');
  const [selection, setSelection] = useState('overall');
  const [view, setView] = useState('trend');
  const [bedrooms, setBedrooms] = useState(1);
  const [pinned, setPinned] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [remote, setRemote] = useState<(RentMarket & { region: string; grouping: string }) | null>(null);
  const [failedLoad, setFailedLoad] = useState('');
  const [historyArea, setHistoryArea] = useState<string | undefined>();

  useEffect(() => {
    if (dataset !== 'market' || !loadMarket) return;
    const controller = new AbortController();
    loadMarket(region, grouping, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setRemote({ ...data, region, grouping });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailedLoad(region + '|' + grouping);
      });
    return () => controller.abort();
  }, [dataset, region, grouping, loadMarket]);

  const published = dataset === 'market' && remote?.region === region && remote.grouping === grouping ? remote : null;
  // Without the server's figures, native builds chart the bundled snapshot; the web build has none.
  const marketState =
    dataset !== 'market' || published || offlineRentData
      ? 'ready'
      : !loadMarket || failedLoad === region + '|' + grouping
        ? 'failed'
        : 'loading';
  const month = published?.month ?? SNAPSHOT_MONTH;
  const areas = useMemo(
    () =>
      published?.areas ??
      (dataset === 'market'
        ? offlineRentData
          ? rentAreas(offlineRentData.listings(), { region, grouping })
          : []
        : rentAreas(saved, { region, grouping })),
    [published, dataset, saved, region, grouping],
  );
  const history = useMemo<RentHistory>(
    () =>
      published?.history ??
      (offlineRentData?.history(month, 'nyc', grouping) ?? []).map(([period, rows]) => [period, rows.filter(([id]) => id !== 'overall')]),
    [published, month, grouping],
  );
  const search = query.trim().toLowerCase();
  const areaChoices = search
    ? areas.filter(({ id, label, detail }) => id !== 'overall' && `${label} ${detail}`.toLowerCase().includes(search))
    : areas;
  const selected = areaChoices.find(({ id }) => id === selection) ?? areaChoices[0];
  const pinnedAreas = pinned.map((id) => areas.find((area) => area.id === id)).filter((area): area is RentArea => Boolean(area));
  const trend = dataset === 'market' && view === 'trend';

  function resetAreas(setter: (value: string) => void, value: string) {
    setter(value);
    setSelection('overall');
    setQuery('');
    setPinned([]);
    setVisible(PAGE_SIZE);
  }

  if (dataset === 'dashboard')
    return (
      <View style={styles.marketplacePanel}>
        <Button secondary onPress={() => setDataset('market')}>
          Back to rent trends
        </Button>
        <MarketHistory load={loadHistory} initialArea={historyArea} />
      </View>
    );

  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text style={styles.chartKicker}>MARKET DATA</Text>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          Rent trends
        </Text>
        <Text style={styles.bodyText}>Compare monthly asking rents for studios through four bedrooms.</Text>
      </View>
      <View style={styles.chipRow}>
        <Chip selected={dataset === 'market'} onPress={() => resetAreas(setDataset, 'market')}>
          Market snapshot
        </Chip>
        <Chip
          selected={false}
          onPress={() => {
            setHistoryArea(undefined);
            setDataset('dashboard');
          }}
        >
          Market history 2010–2026
        </Chip>
        <Chip selected={dataset === 'saved'} onPress={() => resetAreas(setDataset, 'saved')}>
          Saved listings
        </Chip>
      </View>
      <View style={styles.chartControls}>
        <Text style={styles.fieldLabel}>Region</Text>
        <View style={styles.chipRow}>
          {Object.entries(NYC_SEARCH_AREAS).map(([id, area]) => (
            <Chip key={id} selected={region === id} onPress={() => resetAreas(setRegion, id)}>
              {area.label}
            </Chip>
          ))}
        </View>
        <Text style={styles.fieldLabel}>Group areas by</Text>
        <View style={styles.chipRow}>
          {GROUPINGS.map(([key, label]) => (
            <Chip key={key} selected={grouping === key} onPress={() => resetAreas(setGrouping, key)}>
              {label}
            </Chip>
          ))}
        </View>
        {areas.length > 0 && (
          <Field
            label="Find an area"
            placeholder="Search names or ZIP codes"
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setSelection('overall');
              setVisible(PAGE_SIZE);
              // A ZIP code is found among ZIP areas, in its own borough, whatever was chosen above.
              const digits = value.trim();
              if (!/^\d{1,5}$/.test(digits)) return;
              if (grouping !== 'zip') {
                setGrouping('zip');
                setPinned([]);
              }
              const borough = digits.length === 5 ? searchBorough({ state: 'NY', zip: digits }) : null;
              const covered =
                region === borough || (region === 'manhattan-brooklyn' && (borough === 'manhattan' || borough === 'brooklyn'));
              if (borough && !covered) {
                setRegion(borough);
                setPinned([]);
              }
            }}
            maxLength={80}
          />
        )}
      </View>
      {selected ? (
        <>
          {dataset === 'market' && (
            <View style={styles.chipRow}>
              <Chip selected={trend} onPress={() => setView('trend')}>
                Over time
              </Chip>
              <Chip selected={!trend} onPress={() => setView('sizes')}>
                By bedroom
              </Chip>
            </View>
          )}
          {trend ? (
            <View style={styles.chartCard}>
              <Text accessibilityRole="header" style={styles.fieldLabel}>
                Median asking rent over time
              </Text>
              <View style={styles.chipRow}>
                {SIZES.map((label, index) => (
                  <Chip key={label} selected={bedrooms === index} onPress={() => setBedrooms(index)}>
                    {label}
                  </Chip>
                ))}
              </View>
              <RentTrend
                areas={[selected, ...pinnedAreas.filter(({ id }) => id !== selected.id)]}
                bedrooms={bedrooms}
                month={month}
                history={history}
              />
              {dataset === 'market' && loadHistory && grouping !== 'zip' && (
                // This snapshot starts in May 2026. StreetEasy's figures for the same neighborhood or borough go back
                // to 2010, though not by ZIP code.
                <Pressable
                  accessibilityRole="link"
                  onPress={() => {
                    setHistoryArea(selected.id === 'overall' ? 'NYC' : selected.label);
                    setDataset('dashboard');
                  }}
                >
                  <Text style={styles.linkText}>
                    {selected.id === 'overall' ? 'New York City' : selected.label} since 2010 (StreetEasy) →
                  </Text>
                </Pressable>
              )}
              <View style={styles.chartCompare}>
                <Text style={styles.smallMuted}>Pin this area, then select another in the table to compare.</Text>
                <View style={styles.chipRow}>
                  {!pinned.includes(selected.id) && pinned.length < 2 && (
                    <Chip onPress={() => setPinned([...pinned, selected.id])}>+ Pin {selected.label}</Chip>
                  )}
                  {pinnedAreas.map(({ id, label }) => (
                    <Chip key={id} selected onPress={() => setPinned(pinned.filter((item) => item !== id))}>
                      {label} ×
                    </Chip>
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <MedianBars area={selected} />
          )}
          <View style={styles.chartIntro}>
            <Text accessibilityRole="header" style={styles.fieldLabel}>
              {dataset === 'market' ? formatSnapshotMonth(month) + ' medians by area' : 'Saved listing medians by area'}
            </Text>
            <Text style={styles.smallMuted}>Select an area to update the chart. Each median includes its listing count.</Text>
          </View>
          <RentTable areas={areaChoices.slice(0, visible)} selection={selected.id} choose={setSelection} />
          {visible < areaChoices.length && (
            <Button secondary onPress={() => setVisible(visible + PAGE_SIZE)}>
              Show more areas ({visible} of {areaChoices.length})
            </Button>
          )}
        </>
      ) : marketState !== 'ready' ? (
        <View style={styles.empty} aria-live="polite">
          <Text accessibilityRole="header" style={styles.panelTitle}>
            {marketState === 'loading' ? 'Loading rent data…' : 'Rent data is unavailable'}
          </Text>
          {marketState === 'failed' && <Text style={styles.bodyText}>The rent figures could not be loaded. Try again shortly.</Text>}
        </View>
      ) : (
        <View style={styles.empty}>
          <Text accessibilityRole="header" style={styles.panelTitle}>
            {search ? 'No matching area' : 'No rent observations here'}
          </Text>
          <Text style={styles.bodyText}>
            {search
              ? 'Try another name or grouping.'
              : dataset === 'market'
                ? 'The public snapshot has no observations for this selection.'
                : 'Add or save listings in this area to compare their asking rents.'}
          </Text>
          {!search && (
            <Button secondary onPress={showSaved}>
              Open saved listings
            </Button>
          )}
        </View>
      )}
      <View style={styles.chartSource}>
        {dataset === 'market' ? (
          <>
            <Text style={styles.fieldLabel}>About this data</Text>
            <Text style={styles.smallMuted}>
              These medians use initial asking rents in Manhattan and Brooklyn. The combined median is available for the latest month.
              Select a neighborhood, borough, or ZIP to see earlier observations.
            </Text>
            <Link label="View source data" url={SNAPSHOT_SOURCE} onError={onError} />
          </>
        ) : (
          <Text style={styles.smallMuted}>Asking rents and dates from the listings you saved on this device.</Text>
        )}
      </View>
    </View>
  );
}
