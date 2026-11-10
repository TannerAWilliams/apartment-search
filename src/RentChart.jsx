import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { formatSnapshotMonth, marketSnapshot, rentAreas, SNAPSHOT_SOURCE } from './market.mjs';
import { REGIONS } from './regions.mjs';
import { bedroomLabel, formatRent } from './search.mjs';
import { styles } from './styles.js';
import { Button, Chip, Field, Link } from './ui.jsx';

const SIZES = ['Studio', '1 BR', '2 BR', '3 BR', '4 BR'];
const BAR_COLORS = ['#6a9e85', '#4f846a', '#45789b', '#745c9a', '#936425'];
const GROUPINGS = [['neighborhood', 'Neighborhood'], ['city', 'Borough / city'], ['zip', 'ZIP code']];
const PAGE_SIZE = 15;

function MedianBars({ area }) {
  const largest = Math.max(1, ...area.sizes.map(({ median }) => median ?? 0));
  return <View style={styles.chartCard}>
    <Text accessibilityRole="header" style={styles.panelTitle}>{area.label}</Text>
    <Text style={styles.smallMuted}>{[area.detail, `${area.count.toLocaleString('en-US')} listings`].filter(Boolean).join(' · ')}</Text>
    {area.sizes.map(({ median, count }, index) =>
      <View key={SIZES[index]} style={styles.barRow}
        accessibilityLabel={`${bedroomLabel(index)}, ${median === null ? 'no observations' : formatRent(median) + ' median asking rent, ' + count + ' listings'}`}>
        <Text style={styles.barLabel}>{SIZES[index]}</Text>
        <View style={styles.barTrack}>
          {median !== null && <View style={[styles.barFill, { width: `${median / largest * 100}%`, backgroundColor: BAR_COLORS[index] }]} />}
        </View>
        <View style={styles.barValue}>
          <Text style={styles.chartPrice}>{median === null ? '—' : formatRent(median)}</Text>
          <Text style={styles.chartCount}>{count === 0 ? 'No data' : `n = ${count}`}</Text>
        </View>
      </View>)}
  </View>;
}

function RentTable({ areas, selection, choose }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled"
    accessibilityLabel="Median asking rent table, swipe horizontally for more bedroom sizes">
    <View style={styles.chartTable}>
      <View style={styles.chartTableHeader}>
        <Text style={[styles.chartTablePlace, styles.fieldLabel]}>Area</Text>
        {SIZES.map((label) => <Text key={label} style={[styles.chartCell, styles.fieldLabel]}>{label}</Text>)}
      </View>
      {areas.map((area) => <Pressable key={area.id} accessibilityRole="button"
        accessibilityState={{ selected: selection === area.id }} accessibilityLabel={`Show chart for ${area.label} ${area.detail}`}
        onPress={() => choose(area.id)} style={[styles.chartTableRow, selection === area.id && styles.chartTableSelected]}>
        <View style={styles.chartTablePlace}>
          <Text style={styles.fieldLabel}>{area.label}</Text>
          {area.detail !== '' && <Text style={styles.chartCount}>{area.detail}</Text>}
        </View>
        {area.sizes.map(({ median, count }, index) => <View key={SIZES[index]} style={styles.chartCell}>
          <Text style={styles.chartPrice}>{median === null ? '—' : formatRent(median)}</Text>
          <Text style={styles.chartCount}>{count === 0 ? ' ' : `n = ${count}`}</Text>
        </View>)}
      </Pressable>)}
    </View>
  </ScrollView>;
}

export function RentChart({ initialRegion, saved, onError, showSaved, loadMarket }) {
  const [dataset, setDataset] = useState('market');
  const [region, setRegion] = useState(initialRegion);
  const [grouping, setGrouping] = useState('neighborhood');
  const [selection, setSelection] = useState('overall');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    if (dataset !== 'market' || !loadMarket) return;
    const controller = new AbortController();
    loadMarket(region, grouping, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setRemote({ ...data, region, grouping }); })
      .catch(() => {});
    return () => controller.abort();
  }, [dataset, region, grouping, loadMarket]);

  const published = dataset === 'market' && remote?.region === region && remote.grouping === grouping ? remote : null;
  const areas = useMemo(() => published?.areas ?? rentAreas(dataset === 'market' ? marketSnapshot() : saved, { region, grouping }),
    [published, dataset, saved, region, grouping]);
  const search = query.trim().toLowerCase();
  const areaChoices = search ? areas.filter(({ id, label, detail }) =>
    id !== 'overall' && `${label} ${detail}`.toLowerCase().includes(search)) : areas;
  const selected = areaChoices.find(({ id }) => id === selection) ?? areaChoices[0];

  function resetAreas(setter, value) {
    setter(value);
    setSelection('overall');
    setQuery('');
    setVisible(PAGE_SIZE);
  }

  return <View style={styles.marketplacePanel}>
    <View style={styles.chartIntro}>
      <Text accessibilityRole="header" style={styles.panelTitle}>Median asking rent</Text>
      <Text style={styles.bodyText}>Compare studios through four bedrooms. The chart uses every included listing in the area, regardless of your apartment search budget or distance.</Text>
    </View>
    <View style={styles.chipRow}>
      <Chip selected={dataset === 'market'} onPress={() => resetAreas(setDataset, 'market')}>Market snapshot</Chip>
      <Chip selected={dataset === 'saved'} onPress={() => resetAreas(setDataset, 'saved')}>Saved listings</Chip>
    </View>
    <View style={styles.chartSource}>
      {dataset === 'market' ? <>
        <Text style={styles.fieldLabel}>{formatSnapshotMonth(published?.month)} · FirstMover Open Data</Text>
        <Text style={styles.smallMuted}>Initial asking prices for new listings in NYC and parts of North Jersey.</Text>
        <Link label="View source data" url={SNAPSHOT_SOURCE} onError={onError} />
      </> : <Text style={styles.smallMuted}>Asking rents and dates from the listings you saved on this device.</Text>}
    </View>
    <Text style={styles.fieldLabel}>Region</Text>
    <View style={styles.chipRow}>
      {Object.entries(REGIONS).map(([id, area]) =>
        <Chip key={id} selected={region === id} onPress={() => resetAreas(setRegion, id)}>{area.label}</Chip>)}
    </View>
    <Text style={styles.fieldLabel}>Group areas by</Text>
    <View style={styles.chipRow}>
      {GROUPINGS.map(([key, label]) =>
        <Chip key={key} selected={grouping === key} onPress={() => resetAreas(setGrouping, key)}>{label}</Chip>)}
    </View>
    {areas.length > 0 && <Field label="Find an area" placeholder="Search names or ZIP codes" value={query}
      onChangeText={(value) => { setQuery(value); setSelection('overall'); setVisible(PAGE_SIZE); }} maxLength={80} />}
    {selected ? <>
      <MedianBars area={selected} />
      <Text style={styles.smallMuted}>Select a row to update the chart. Sample counts appear under each median.</Text>
      <RentTable areas={areaChoices.slice(0, visible)} selection={selected.id} choose={setSelection} />
      {visible < areaChoices.length && <Button secondary onPress={() => setVisible(visible + PAGE_SIZE)}>
        Show more areas ({visible} of {areaChoices.length})
      </Button>}
    </> : <View style={styles.empty}>
      <Text accessibilityRole="header" style={styles.panelTitle}>{search ? 'No matching area' : 'No rent observations here'}</Text>
      <Text style={styles.bodyText}>{search ? 'Try another name or grouping.' :
        dataset === 'market' ? 'The public snapshot covers NYC and parts of North Jersey. You can chart your saved listings for other areas.' :
          'Add or save listings in this area to compare their asking rents.'}</Text>
      {!search && <Button secondary onPress={showSaved}>Open saved listings</Button>}
    </View>}
  </View>;
}
