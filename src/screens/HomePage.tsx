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

const REASONS: [title: string, body: string][] = [
  ['Every listing, one search', 'More than 40 listing sites, brokerages and landlords, so you stop checking ten apps.'],
  ['Know a deal when you see it', 'Every rent is compared with similar apartments nearby, and rent-stabilized buildings are marked.'],
  ['The building, before you tour', 'Open violations, complaints, pests, evictions and court cases from city records, graded A to D.'],
];

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
          Every listing site in one search, with real deals, building grades and rent-stabilized apartments marked. Free, no account needed.
        </Text>
        <HomeSearch onSearch={onSearch} loadNeighborhoods={loadNeighborhoods} />
      </View>

      {/* What the paid plan is for, said where everyone sees it: the good apartments go to whoever hears first. */}
      <View
        style={{
          flexDirection: wide ? 'row' : 'column',
          alignItems: wide ? 'center' : 'flex-start',
          gap: 14,
          padding: wide ? 20 : 16,
          borderRadius: 16,
          backgroundColor: colors.light,
        }}
      >
        <View style={{ flex: wide ? 1 : undefined, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <BellIcon color={colors.green} size={18} />
            <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>
              Hear about a new apartment before it’s gone
            </Text>
          </View>
          <Text style={styles.bodyText}>
            Tell Walkup what you’re looking for and get an email when a match is listed, checked every two hours.
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Button onPress={() => onOpen('alerts')}>Get email alerts</Button>
          <Pressable accessibilityRole="link" onPress={() => onOpen('pricing')} style={{ paddingVertical: 6 }}>
            <Text style={styles.linkText}>Pricing</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {REASONS.map(([title, body]) => (
          <View
            key={title}
            style={{
              flexGrow: 1,
              flexBasis: wide ? 300 : 260,
              gap: 4,
              padding: 16,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{title}</Text>
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
