import { useState } from 'react';
import { type ConfigSource, type RefreshInfo } from '../api-client.ts';
import type { SearchFilters, SearchResult } from '../domain.ts';

import { Pressable, ScrollView, Text, View } from 'react-native';
import { NYC_COMPANIES } from '../companies.ts';
import { marketsForSearch } from '../regions.ts';
import { marketplaceLinks } from '../marketplaces.ts';
import { styles } from '../styles.ts';
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
  const [showCompanies, setShowCompanies] = useState(false);
  const market = markets.find((item) => item.label === marketLabel) ?? markets.find((item) => item.zip === filters.zip) ?? markets[0];
  const searchFeeds = new Set(sources.filter(({ status }) => status === 'searched').map(({ id }) => id));
  const configured = new Set(configuredSources.map(({ id }) => id));
  const unavailable = new Set(sources.filter(({ status }) => status === 'unavailable').map(({ id }) => id));
  const feedRequired = new Set(refresh?.sources.filter(({ status }) => status === 'feed_required').map(({ marketplace }) => marketplace));

  const status = (id: string) =>
    configuredSources.some((source) => source.id === id && source.sample) || searchFeeds.has(id) || configured.has(id)
      ? 'In this app'
      : unavailable.has(id)
        ? 'Unavailable right now'
        : feedRequired.has(id)
          ? 'Needs a paid feed'
          : '';

  return (
    <View style={styles.marketplacePanel}>
      <Text accessibilityRole="header" style={styles.panelTitle}>
        Browse rental platforms
      </Text>
      <Text style={styles.bodyText}>Each site opens with your search (area, bedrooms and price) filled in where the site allows it.</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.marketChips}
      >
        {markets.map((item) => (
          <Chip key={item.label} selected={item === market} onPress={() => setMarketLabel(item.label)}>
            {item.label}
          </Chip>
        ))}
      </ScrollView>
      {filters.zip !== '' && <Text style={styles.smallMuted}>ZIP {filters.zip} is used on sites that search by ZIP.</Text>}
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
              {status(id) !== '' && <Text style={styles.marketType}>{status(id)}</Text>}
            </View>
            <Text style={styles.marketArrow}>↗</Text>
          </ExternalLink>
        ))}
      </View>
      <Text style={styles.fieldLabel}>Search several sites at once</Text>
      <View style={styles.chipRow}>
        <Link label="RentReboot" url="https://rentreboot.com/" onError={onError} />
        <Text style={styles.smallMuted}> · </Text>
        <Link label="Lessia’s List" url="https://lessiaslist.com/" onError={onError} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showCompanies }}
        onPress={() => setShowCompanies(!showCompanies)}
      >
        <Text style={styles.linkText}>
          {showCompanies ? 'Hide brokerages and landlords ▴' : `Brokerages and landlords (${NYC_COMPANIES.length}) ▾`}
        </Text>
      </Pressable>
      {showCompanies && (
        <View style={styles.menu}>
          {NYC_COMPANIES.map(({ id, name, url, type }, index) => (
            <View key={id} style={[styles.menuRow, index > 0 && styles.menuDivider, { minHeight: 52, paddingVertical: 8 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.fieldLabel}>{name}</Text>
                <Text style={styles.smallMuted}>
                  {type}
                  {companies[id] ? ` · ${companies[id].toLocaleString('en-US')} in the snapshot` : ''}
                </Text>
              </View>
              {configured.has(id) && (
                <Button secondary onPress={() => onCompany(name)}>
                  Search here
                </Button>
              )}
              <Link label="Website" url={url} onError={onError} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
