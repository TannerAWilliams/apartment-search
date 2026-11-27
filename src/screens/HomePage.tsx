/**
 * The home page, at the site's address, for everyone. The search comes first, as on a search site's front page;
 * under it the one thing Walkup charges for (an email when a new apartment matches), then one real apartment
 * with what Walkup knows about it. It says what is there and no more: figures when the app has them, nothing
 * where it has none. It asks for no apartments of its own, so it opens at once; the search the app runs on
 * opening readies the first search made here. The longer account of what Walkup does, and its prices, are
 * pages of their own (AboutPage.tsx), linked from the foot of every page.
 */
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { HomeSearch, type NeighborhoodLoader } from '../components/HomeSearch.tsx';
import { BellIcon } from '../components/Icons.tsx';
import { PRICING } from '../about-copy.ts';
import { Button } from '../components/ui.tsx';
import type { SearchFilters } from '../domain.ts';
import type { HomeExample } from '../home-example.ts';
import { colors, styles } from '../styles.ts';

/** How much there is to search, when the app knows: every apartment and the sites they came from. */
export type SiteStats = { apartments: number; sources: number };

const NAMES = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' });

/** What Walkup knows about the example apartment, each as the figure its card carries and where it comes from. */
function notes(example: HomeExample): [figure: string, body: string][] {
  const { below, grade, sites } = example;
  return [
    ...(below ? [[below, 'Its rent, next to apartments of the same size nearby.'] as [string, string]] : []),
    ...(grade
      ? [
          [
            `Building ${grade}`,
            'From city records: open violations, heat complaints, bedbugs, rats, evictions and Housing Court cases.',
          ] as [string, string],
        ]
      : []),
    ...(sites.length
      ? [
          [
            `On ${sites.length} sites`,
            `${NAMES.format(sites.length > 3 ? [...sites.slice(0, 3), 'others'] : sites)} list it. It appears once here, with a link to each.`,
          ] as [string, string],
        ]
      : []),
  ];
}

export function HomePage({
  onSearch,
  onOpen,
  loadNeighborhoods,
  stats = null,
  example = null,
  onExample,
}: {
  /** The site's size, once the opening search has said. */
  stats?: SiteStats | null;
  /** A real apartment from the listings in hand, shown as the example of what a card carries; and opening it. */
  example?: HomeExample | null;
  onExample?: (id: string) => void;
  /** Searches with these filters and opens the results. */
  onSearch: (changes: Partial<SearchFilters>) => void;
  onOpen: (tab: string) => void;
  loadNeighborhoods?: NeighborhoodLoader;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  return (
    <View style={{ width: '100%', maxWidth: 1120, alignSelf: 'center', gap: wide ? 20 : 16, paddingTop: wide ? 40 : 4, paddingBottom: 16 }}>
      <View style={{ gap: wide ? 12 : 8, zIndex: 5 }}>
        <Text
          accessibilityRole="header"
          aria-level={1}
          style={{ fontSize: wide ? 40 : 28, lineHeight: wide ? 46 : 34, fontWeight: '700', color: colors.ink, letterSpacing: -1 }}
        >
          Apartments for rent in and around New York City
        </Text>
        <Text style={{ fontSize: wide ? 18 : 16, lineHeight: wide ? 26 : 23, color: colors.muted, maxWidth: 720 }}>
          {stats
            ? `${stats.apartments.toLocaleString('en-US')} listed now, from ${stats.sources} sources: listing sites, brokerages and landlords.`
            : 'From listing sites, brokerages and landlords, in one search.'}{' '}
          Free to search, no account.
        </Text>
        <HomeSearch onSearch={onSearch} loadNeighborhoods={loadNeighborhoods} />
      </View>

      {/* The one thing Walkup charges for, with what is free and what the price is. */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderRadius: 14,
          backgroundColor: colors.light,
        }}
      >
        <BellIcon color={colors.accent} size={20} />
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 220, gap: 2 }}>
          <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
            Get an email when a new apartment matches
          </Text>
          <Text style={styles.smallMuted}>
            One alert is free, sent three hours after a match is found. {PRICING.monthly} sends every match as soon as it is found.
          </Text>
        </View>
        <Button onPress={() => onOpen('alerts')}>Get a free alert</Button>
      </View>

      {/* One real apartment and what Walkup knows about it. Nothing is shown until there is one. */}
      {example && (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ fontSize: 18, lineHeight: 24, fontWeight: '600', color: colors.ink }}>
            One of the apartments listed now
          </Text>
          <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
            <View style={{ padding: 18, gap: 2, backgroundColor: colors.light }}>
              <Text accessibilityRole="header" numberOfLines={1} style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>
                {example.title}
              </Text>
              <Text numberOfLines={1} style={styles.smallMuted}>
                {example.place}
              </Text>
              <Text style={{ fontSize: 22, lineHeight: 28, fontWeight: '700', color: colors.ink }}>
                {example.rent} <Text style={styles.smallMuted}>/ month</Text>
              </Text>
            </View>
            {notes(example).map(([figure, body]) => (
              <View
                key={figure}
                style={{
                  flexDirection: wide ? 'row' : 'column',
                  gap: wide ? 16 : 6,
                  padding: 18,
                  alignItems: wide ? 'center' : 'flex-start',
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <Text style={{ width: wide ? 190 : undefined, fontSize: 15, fontWeight: '700', color: colors.ink }}>{figure}</Text>
                <Text style={[styles.bodyText, { flex: wide ? 1 : undefined }]}>{body}</Text>
              </View>
            ))}
            {onExample && (
              <Pressable
                accessibilityRole="link"
                onPress={() => onExample(example.id)}
                style={{ padding: 18, borderTopWidth: 1, borderTopColor: colors.border }}
              >
                <Text style={styles.linkText}>See this apartment</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
