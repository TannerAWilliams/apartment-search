import { useState } from 'react';
import { type ConfigSource, type RefreshInfo } from '../api-client.ts';
import type { SearchFilters, SearchResult } from '../domain.ts';

import { ScrollView, Text, View } from 'react-native';
import { NYC_COMPANIES } from '../companies.ts';
import { marketsForSearch } from '../regions.ts';
import { marketplaceLinks } from '../marketplaces.ts';
import { styles } from '../styles.ts';
import { formatSnapshotMonth, SNAPSHOT_SOURCE } from '../market.ts';
import { Button, Chip, ExternalLink, Link } from '../components/ui.tsx';

export function Marketplaces({
  filters,
  sources,
  configuredSources,
  companies,
  onCompany,
  refresh,
  onError,
}: {
  filters: SearchFilters;
  sources: SearchResult['sources'];
  configuredSources: ConfigSource[];
  companies: Record<string, number>;
  onCompany: (name: string) => void;
  refresh: RefreshInfo | null;
  onError: (message: string) => void;
}) {
  const markets = marketsForSearch(filters);
  const [marketLabel, setMarketLabel] = useState('');
  const market = markets.find((item) => item.label === marketLabel) ?? markets.find((item) => item.zip === filters.zip) ?? markets[0];
  const searchFeeds = new Set(sources.filter(({ status }) => status === 'searched').map(({ id }) => id));
  const configured = new Set(configuredSources.map(({ id }) => id));
  const sampleNames = configuredSources.filter(({ sample }) => sample).map(({ name }) => name);
  const unavailable = new Set(sources.filter(({ status }) => status === 'unavailable').map(({ id }) => id));
  const feedRequired = new Set(refresh?.sources.filter(({ status }) => status === 'feed_required').map(({ marketplace }) => marketplace));

  return (
    <View style={styles.marketplacePanel}>
      <Text accessibilityRole="header" style={styles.panelTitle}>
        Browse rental platforms
      </Text>
      <View style={styles.chartSource}>
        <Text style={styles.fieldLabel}>Search several NYC sites at once</Text>
        <Link label="RentReboot" url="https://rentreboot.com/" onError={onError} />
        <Link label="Lessia’s List" url="https://lessiaslist.com/" onError={onError} />
      </View>
      <Text style={styles.bodyText}>
        Live results come from recent marketplace checks. FirstMover’s{' '}
        {formatSnapshotMonth(refresh?.sources.find(({ id }) => id === 'firstmover')?.month)} snapshot supplies the rent charts.
      </Text>
      <View style={styles.chartSource}>
        <Text style={styles.fieldLabel}>
          {sampleNames.length ? sampleNames.length + ' connected listing sources' : 'Recent live samples unavailable'}
        </Text>
        {sampleNames.length > 0 && <Text style={styles.smallMuted}>{sampleNames.join(' · ')}</Text>}
        <Link label="FirstMover Open Data" url={SNAPSHOT_SOURCE} onError={onError} />
        <Text style={styles.smallMuted}>Settled.nyc · source access unverified.</Text>
      </View>
      <Text style={styles.fieldLabel}>Marketplace area</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled" contentContainerStyle={styles.marketChips}>
        {markets.map((item) => (
          <Chip key={item.label} selected={item === market} onPress={() => setMarketLabel(item.label)}>
            {item.label}
          </Chip>
        ))}
      </ScrollView>
      {filters.zip !== '' && <Text style={styles.smallMuted}>ZIP {filters.zip} is used on platforms with ZIP searches.</Text>}
      <View style={styles.marketGrid}>
        {marketplaceLinks(market, filters).map(({ id, name, url, detail }) => (
          <ExternalLink
            key={id}
            url={url}
            onError={onError}
            accessibilityLabel={`Open ${name}, ${detail}`}
            style={({ pressed }) => [styles.marketCard, pressed && styles.pressed]}
          >
            <View style={styles.marketInfo}>
              <Text style={styles.marketName}>{name}</Text>
              <Text style={styles.smallMuted}>{detail}</Text>
            </View>
            <Text style={styles.marketArrow}>↗</Text>
            <Text style={styles.marketType}>
              {configuredSources.some((source) => source.id === id && source.sample)
                ? 'PUBLIC SEARCH CONNECTED'
                : searchFeeds.has(id)
                  ? 'FREE LIVE FEED'
                  : unavailable.has(id)
                    ? 'FEED UNAVAILABLE'
                    : configured.has(id)
                      ? 'FREE FEED CONFIGURED'
                      : feedRequired.has(id)
                        ? 'AUTHORIZED FEED REQUIRED'
                        : 'BROWSE ONLY'}
            </Text>
          </ExternalLink>
        ))}
      </View>
      <Text accessibilityRole="header" style={styles.panelTitle}>
        NYC brokerages and apartment companies
      </Text>
      <Text style={styles.bodyText}>Counts come from the dated StreetEasy export. Open a company’s website for its current listings.</Text>
      <View style={styles.marketGrid}>
        {NYC_COMPANIES.map(({ id, name, url, type }) => (
          <View key={id} style={[styles.chartCard, { flexGrow: 1, flexBasis: '46%', minWidth: 150 }]}>
            <Text style={styles.marketName}>{name}</Text>
            <Text style={styles.smallMuted}>
              {type} ·{' '}
              {configured.has(id)
                ? 'Feed configured'
                : companies[id]
                  ? companies[id].toLocaleString('en-US') + ' in the snapshot'
                  : 'Website link'}
              {feedRequired.has(id) && !configured.has(id) ? ' · Authorized feed required' : ''}
            </Text>
            {configured.has(id) && (
              <Button secondary onPress={() => onCompany(name)}>
                Search in Apartment Search
              </Button>
            )}
            <Link label="Company website" url={url} onError={onError} />
          </View>
        ))}
      </View>
    </View>
  );
}
