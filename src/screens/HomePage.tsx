/**
 * The home page, at the site's address, for everyone. The search comes first, as on a search site's front page;
 * under it the one thing Walkup charges for (an email when a new apartment matches), then three reasons to
 * search here. It shows no apartments, so it opens at once; the search the app runs on opening readies the first
 * search made here. The longer account of what Walkup does, and its prices, are pages of their own
 * (AboutPage.tsx).
 */
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { HomeSearch, type NeighborhoodLoader } from '../components/HomeSearch.tsx';
import { BellIcon } from '../components/Icons.tsx';
import { Button } from '../components/ui.tsx';
import type { SearchFilters } from '../domain.ts';
import { colors, styles } from '../styles.ts';

/** How much there is to search, when the app knows: every apartment and the sites they came from. */
export type SiteStats = { apartments: number; sources: number };

/**
 * Three reasons to search here, each led by the figure that makes it concrete. The counts are the site's own,
 * from the search it opens with; until that arrives the sentences stand without them.
 */
function reasons(stats: SiteStats | null): [figure: string, title: string, body: string][] {
  // "17,000+": the count rounded down, so it stays true as listings come and go through the day.
  const apartments = stats && stats.apartments >= 1000 ? `${(Math.floor(stats.apartments / 500) * 500).toLocaleString('en-US')}+` : null;
  return [
    [
      stats ? `${stats.sources} sites` : 'One search',
      'Stop checking ten apps',
      `${apartments ? `${apartments} apartments` : 'Apartments'} from listing sites, brokerages and landlords in one search. The same apartment on three sites shows once.`,
    ],
    [
      '% vs similar',
      'See what is overpriced',
      'Every rent is compared with similar apartments nearby, so a card says “12% below similar”, and an apartment listed at two prices is flagged.',
    ],
    [
      'A to D',
      'Check the building before you tour',
      'Open violations, bedbugs, rats, heat complaints, evictions and Housing Court cases from city records, as one grade.',
    ],
  ];
}

export function HomePage({
  onSearch,
  onOpen,
  loadNeighborhoods,
  stats = null,
}: {
  /** The site's size, once the opening search has said. */
  stats?: SiteStats | null;
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
          Find your next New York apartment
        </Text>
        <Text style={{ fontSize: wide ? 18 : 16, lineHeight: wide ? 26 : 23, color: colors.muted, maxWidth: 720 }}>
          {stats
            ? `${stats.apartments.toLocaleString('en-US')} apartments from ${stats.sources} sites in one search`
            : 'Every listing site in one search'}
          , with real deals, building grades and rent-stabilized apartments marked. Free, no account needed.
        </Text>
        <HomeSearch onSearch={onSearch} loadNeighborhoods={loadNeighborhoods} />
      </View>

      {/* The one thing Walkup charges for, said in a line: the good apartments go to whoever hears first. */}
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
            New listings, emailed to you
          </Text>
          <Text style={styles.smallMuted}>Free for one search. The paid plan tells you first.</Text>
        </View>
        <Button onPress={() => onOpen('alerts')}>Get a free alert</Button>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {reasons(stats).map(([figure, title, body]) => (
          <View
            key={title}
            style={{
              flexGrow: 1,
              flexBasis: wide ? 300 : 260,
              gap: 6,
              padding: 18,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 26, lineHeight: 30, fontWeight: '700', letterSpacing: -0.6, color: colors.ink }}>{figure}</Text>
            <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>
              {title}
            </Text>
            <Text style={styles.bodyText}>{body}</Text>
          </View>
        ))}
      </View>
      <Pressable accessibilityRole="link" onPress={() => onOpen('about')} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
        <Text style={styles.linkText}>How Walkup works</Text>
      </Pressable>
    </View>
  );
}
