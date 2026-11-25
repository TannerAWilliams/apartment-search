/**
 * The home page, at the site's address, for everyone, laid out as listing sites lay theirs out: a search bar
 * (where, bedrooms, the most rent), popular neighborhoods, then real apartments (today's best deals and what is
 * new), then what Walkup does, plans and common questions. Signing in is only needed to save, get alerts or share.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { HomeSearch, type NeighborhoodLoader } from '../components/HomeSearch.tsx';
import { Listing } from '../components/Listing.tsx';
import type { ListingData, SearchFilters, SourceLink, Workplace } from '../domain.ts';
import { colors, styles } from '../styles.ts';

const FEATURES: [title: string, body: string][] = [
  ['Every listing, one search', 'Walkup reads more than 40 listing sites, brokerages and landlords, so you stop checking ten apps.'],
  ['Know a deal when you see it', 'Every rent is compared with similar apartments nearby, so “12% below similar” means something.'],
  ['Rent-stabilized buildings', 'Built from New York State’s list of about 57,000 registered buildings, with a filter for them.'],
  ['Buildings graded A to D', 'Open violations, complaints, bedbug filings and flood zones from city records, before you tour.'],
  ['Alerts within hours', 'New matches are checked every two hours from 8 AM to 10 PM, so you hear first, not the next morning.'],
  ['Search together', 'Share a list with a partner or roommates, vote, leave notes and see everyone’s commute.'],
];
const QUESTIONS: [question: string, answer: string][] = [
  ['Is Walkup a broker?', 'No. Walkup is a search tool; it never charges a broker fee and doesn’t represent landlords.'],
  [
    'Where do listings come from?',
    'Landlords, management companies, brokerages and listing sites, plus city and state open data about buildings.',
  ],
  ['Can I cancel?', 'Yes, anytime from your Profile. The three-month pass doesn’t renew.'],
  [
    'What does it cost?',
    'Searching and market data are free without an account. A free account saves apartments; email alerts are part of the paid plan.',
  ],
];

/** What a row of apartments on the home page needs to show and act on its cards. */
export type ListingActions = {
  workplace: Workplace;
  onOpen: (listing: ListingData) => void;
  onSave: (listing: ListingData) => void;
  onSaveLink: (listing: ListingData, link: SourceLink) => void;
  saved: (listing: ListingData) => boolean;
  onError: (message: string) => void;
};

/** A titled row of apartments that scrolls sideways, with a link to all of them. */
function ListingRow({
  title,
  filters,
  preview,
  actions,
  onSeeAll,
}: {
  title: string;
  filters: Partial<SearchFilters>;
  preview: (filters: Partial<SearchFilters>) => Promise<ListingData[]>;
  actions: ListingActions;
  onSeeAll: () => void;
}) {
  const [listings, setListings] = useState<ListingData[] | null>(null);
  useEffect(() => {
    let current = true;
    preview(filters)
      .then((found) => current && setListings(found.slice(0, 10)))
      .catch(() => current && setListings([]));
    return () => {
      current = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: each row asks once
  }, []);
  if (listings && listings.length === 0) return null;
  return (
    <View style={{ gap: 12, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>
          {title}
        </Text>
        <Pressable accessibilityRole="link" accessibilityLabel={`See all: ${title}`} onPress={onSeeAll}>
          <Text style={styles.linkText}>See all</Text>
        </Pressable>
      </View>
      {listings === null ? (
        <Text style={styles.smallMuted}>Loading apartments…</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 4 }}>
          {listings.map((listing) => (
            <View key={listing.id} style={{ width: 260 }}>
              <Listing
                listing={listing}
                workplace={actions.workplace}
                onOpen={actions.onOpen}
                onSave={actions.onSave}
                onSaveLink={actions.onSaveLink}
                onError={actions.onError}
                saved={actions.saved(listing)}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export function HomePage({
  signedIn,
  onSearch,
  onOpen,
  loadNeighborhoods,
  preview,
  actions,
}: {
  signedIn: boolean;
  /** Searches with these filters and opens the results. */
  onSearch: (changes: Partial<SearchFilters>) => void;
  onOpen: (tab: string) => void;
  loadNeighborhoods?: NeighborhoodLoader;
  /** A few apartments for a row, from a search; none while the server cannot be reached. */
  preview?: (filters: Partial<SearchFilters>) => Promise<ListingData[]>;
  actions: ListingActions;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const column = { width: '100%', maxWidth: 1120, alignSelf: 'center' } as const;
  const heading = { fontSize: wide ? 26 : 22, lineHeight: wide ? 32 : 28, fontWeight: '700', color: colors.ink } as const;
  const deals: Partial<SearchFilters> = { region: 'nyc', belowMarket: true, sort: 'value' };
  const fresh: Partial<SearchFilters> = { region: 'nyc', newWithinDays: 1, sort: 'newest' };
  return (
    <View style={{ paddingBottom: 20 }}>
      <View style={[column, { gap: 18, paddingTop: wide ? 28 : 8, paddingBottom: 8, zIndex: 5 }]}>
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

      {preview && (
        <View style={column}>
          <ListingRow title="Today’s best deals" filters={deals} preview={preview} actions={actions} onSeeAll={() => onSearch(deals)} />
          <ListingRow title="New on Walkup today" filters={fresh} preview={preview} actions={actions} onSeeAll={() => onSearch(fresh)} />
        </View>
      )}

      <View style={[column, { gap: 18, paddingVertical: 24 }]}>
        <Text accessibilityRole="header" style={heading}>
          What Walkup does that listing sites don’t
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
          {FEATURES.map(([title, body]) => (
            <View
              key={title}
              style={{ flexGrow: 1, flexBasis: wide ? 300 : 260, gap: 6, padding: 18, borderRadius: 16, backgroundColor: colors.light }}
            >
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>{title}</Text>
              <Text style={styles.bodyText}>{body}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[column, { gap: 18, paddingVertical: 24 }]}>
        <Text accessibilityRole="header" style={heading}>
          Plans
        </Text>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 14 }}>
          <View style={{ flex: wide ? 1 : undefined, gap: 8, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>Free</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>$0</Text>
            <Text style={styles.bodyText}>
              Search every source, deals and warnings, building grades, rent-stabilized buildings and market data, no account needed. A free
              account adds saved apartments and shared lists.
            </Text>
          </View>
          <View style={{ flex: wide ? 1 : undefined, gap: 8, padding: 20, borderRadius: 16, borderWidth: 2, borderColor: colors.ink }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>Paid</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>
              $15<Text style={{ fontSize: 16, fontWeight: '400', color: colors.muted }}> a month</Text>
            </Text>
            <Text style={styles.smallMuted}>or $35 for three months, paid once</Text>
            <Text style={styles.bodyText}>
              Everything in Free, plus email alerts for new matches and price drops, checked every two hours, for as many searches as you
              need.
            </Text>
          </View>
        </View>
        {!signedIn && (
          <Pressable accessibilityRole="button" onPress={() => onOpen('more')} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
            <Text style={styles.linkText}>Create a free account or sign in</Text>
          </Pressable>
        )}
      </View>

      <View style={[column, { gap: 14, paddingVertical: 24 }]}>
        <Text accessibilityRole="header" style={heading}>
          Questions
        </Text>
        {QUESTIONS.map(([question, answer]) => (
          <View key={question} style={{ gap: 4, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{question}</Text>
            <Text style={styles.bodyText}>{answer}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
