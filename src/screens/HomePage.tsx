/**
 * The home page, at the site's address, for everyone: the search and nothing else, as a search site's front page
 * is. It shows no apartments, so it opens at once; the search the app runs on opening readies the first search
 * made here. What Walkup is and what it costs have pages of their own (AboutPage.tsx), one tap away.
 */
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { HomeSearch, type NeighborhoodLoader } from '../components/HomeSearch.tsx';
import type { SearchFilters } from '../domain.ts';
import { colors, styles } from '../styles.ts';

export function HomePage({
  onSearch,
  onOpen,
  loadNeighborhoods,
}: {
  /** Searches with these filters and opens the results. */
  onSearch: (changes: Partial<SearchFilters>) => void;
  onOpen: (tab: string) => void;
  loadNeighborhoods?: NeighborhoodLoader;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  return (
    <View
      style={{
        width: '100%',
        maxWidth: 1120,
        alignSelf: 'center',
        gap: 18,
        paddingTop: wide ? 72 : 8,
        paddingBottom: wide ? 96 : 24,
        zIndex: 5,
      }}
    >
      <Text
        accessibilityRole="header"
        aria-level={1}
        style={{ fontSize: wide ? 40 : 28, lineHeight: wide ? 46 : 34, fontWeight: '700', color: colors.ink, letterSpacing: -1 }}
      >
        Find your next New York apartment
      </Text>
      <Text style={{ fontSize: wide ? 18 : 16, lineHeight: wide ? 26 : 23, color: colors.muted, maxWidth: 720 }}>
        Every listing site in one search, with real deals, building grades and rent-stabilized apartments marked. Free, no account needed.
      </Text>
      <HomeSearch onSearch={onSearch} loadNeighborhoods={loadNeighborhoods} />
      {/* Under the search, only the way to the rest. */}
      <View style={[styles.chipRow, { zIndex: -1 }]}>
        <Pressable accessibilityRole="link" onPress={() => onOpen('about')} style={{ paddingVertical: 6 }}>
          <Text style={styles.linkText}>How Walkup works</Text>
        </Pressable>
        <Text style={styles.smallMuted}>·</Text>
        <Pressable accessibilityRole="link" onPress={() => onOpen('pricing')} style={{ paddingVertical: 6 }}>
          <Text style={styles.linkText}>Pricing</Text>
        </Pressable>
      </View>
    </View>
  );
}
