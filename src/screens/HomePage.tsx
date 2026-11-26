/**
 * The home page, at the site's address, for everyone. The search comes first, as on a search site's front page;
 * under it the one thing Walkup charges for (an email when a new apartment matches), then what a card carries,
 * shown on one real apartment. It asks for no apartments of its own, so it opens at once; the search the app runs on opening readies the first
 * search made here. The longer account of what Walkup does, and its prices, are pages of their own
 * (AboutPage.tsx).
 */
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { HomeSearch, type NeighborhoodLoader } from '../components/HomeSearch.tsx';
import { BellIcon } from '../components/Icons.tsx';
import { Button } from '../components/ui.tsx';
import type { SearchFilters } from '../domain.ts';
import type { HomeExample } from '../home-example.ts';
import { colors, styles } from '../styles.ts';

/** How much there is to search, when the app knows: every apartment and the sites they came from. */
export type SiteStats = { apartments: number; sources: number };

const NAMES = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' });
/** "17,000+": the count rounded down, so it stays true as listings come and go through the day. */
const rounded = (count: number) => (count >= 1000 ? `${(Math.floor(count / 500) * 500).toLocaleString('en-US')}+` : String(count));

/**
 * What Walkup adds to an apartment, each as the figure a card carries and what stands behind it. With an example
 * apartment the figures are its own; without one (the listings have not arrived) they are described.
 */
function notes(example: HomeExample | null): [figure: string, body: string][] {
  const sites = example?.sites ?? [];
  return [
    [
      example?.below ?? 'Rent vs similar',
      example?.below
        ? 'Its rent against similar apartments nearby. Every apartment gets this, so you see what is overpriced before you tour.'
        : 'Every rent is compared with similar apartments nearby, so you see what is overpriced before you tour.',
    ],
    [
      example?.grade ? `Building ${example.grade}` : 'Building grade',
      'Open violations, bedbugs, rats, heat complaints, evictions and Housing Court cases from city records, as one grade from A to D.',
    ],
    [
      sites.length ? `On ${sites.length} sites` : 'Shown once',
      sites.length
        ? `${NAMES.format(sites.length > 3 ? [...sites.slice(0, 3), 'others'] : sites)} list it. You see it once, with every link.`
        : 'The same apartment on three sites shows once, with every link.',
    ],
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

      {/* What a card carries, shown on a real apartment rather than claimed. */}
      <View style={{ gap: 12 }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4, color: colors.ink }}
        >
          {stats
            ? `${rounded(stats.apartments)} apartments from ${stats.sources} sites, checked today`
            : 'Apartments from listing sites, brokerages and landlords, in one search'}
        </Text>
        <Text style={styles.bodyText}>
          {example
            ? 'Here is one of them, and what Walkup tells you about it that its listing does not.'
            : 'What Walkup tells you about each one that its listing does not:'}
        </Text>
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          {example && (
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
          )}
          {notes(example).map(([figure, body], index) => (
            <View
              key={figure}
              style={[
                { flexDirection: wide ? 'row' : 'column', gap: wide ? 16 : 6, padding: 18, alignItems: wide ? 'center' : 'flex-start' },
                (index > 0 || example) && { borderTopWidth: 1, borderTopColor: colors.border },
              ]}
            >
              <View style={{ width: wide ? 190 : undefined }}>
                <Text
                  style={{
                    alignSelf: 'flex-start',
                    fontSize: 14,
                    fontWeight: '700',
                    color: colors.ink,
                    borderWidth: 1.5,
                    borderColor: colors.accent,
                    borderRadius: 999,
                    paddingVertical: 4,
                    paddingHorizontal: 12,
                  }}
                >
                  {figure}
                </Text>
              </View>
              <Text style={[styles.bodyText, { flex: wide ? 1 : undefined }]}>{body}</Text>
            </View>
          ))}
          {example && onExample && (
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
      <Pressable accessibilityRole="link" onPress={() => onOpen('about')} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
        <Text style={styles.linkText}>How Walkup works</Text>
      </Pressable>
    </View>
  );
}
