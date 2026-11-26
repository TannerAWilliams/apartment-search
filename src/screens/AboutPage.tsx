/**
 * What Walkup is (/about) and what it costs (/pricing): the pages the home page, which is only the search, links
 * to. Each ends on the next step: searching, or an account.
 */
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Button } from '../components/ui.tsx';
import { colors, styles } from '../styles.ts';

const FEATURES: [title: string, body: string][] = [
  [
    'Every listing, one search',
    'Walkup reads listing sites, brokerages and landlords directly and merges them, so the same apartment on three sites shows once and you stop checking ten apps.',
  ],
  ['Know a deal when you see it', 'Every rent is compared with similar apartments nearby, so “12% below similar” means something.'],
  ['Rent-stabilized buildings', 'Built from New York State’s list of about 57,000 registered buildings, with a filter for them.'],
  [
    'Buildings graded A to D',
    'Open violations, complaints, bedbugs, rat inspections, evictions, Housing Court cases and flood zones from city records, before you tour.',
  ],
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
    'Searching and market data are free without an account. A free account saves apartments and keeps one email alert, sent three hours after a match is found. The paid plan sends every match as soon as it is found.',
  ],
];

function useLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  return {
    wide,
    column: { width: '100%', maxWidth: 1120, alignSelf: 'center' } as const,
    heading: { fontSize: wide ? 26 : 22, lineHeight: wide ? 32 : 28, fontWeight: '700', color: colors.ink } as const,
    title: { fontSize: wide ? 40 : 28, lineHeight: wide ? 46 : 34, fontWeight: '700', color: colors.ink, letterSpacing: -1 } as const,
  };
}

export function AboutPage({ onOpen }: { onOpen: (tab: string) => void }) {
  const { wide, column, heading, title } = useLayout();
  return (
    <View>
      <View style={[column, { gap: 12, paddingTop: wide ? 28 : 8 }]}>
        <Text accessibilityRole="header" aria-level={1} style={title}>
          How Walkup works
        </Text>
        <Text style={{ fontSize: wide ? 18 : 16, lineHeight: wide ? 26 : 23, color: colors.muted, maxWidth: 720 }}>
          Walkup is a search tool for New York apartments, not a broker. It reads the listing sites, brokerages and landlords, puts every
          apartment in one search, and checks each against city and state records.
        </Text>
      </View>
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

      <View style={[column, { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 8 }]}>
        <Button onPress={() => onOpen('results')}>Search apartments</Button>
        <Button secondary onPress={() => onOpen('pricing')}>
          See pricing
        </Button>
      </View>
      {/* The footer's own line follows, so the last question has none and the page ends without a gap. */}
      <View style={[column, { gap: 14, paddingTop: 24 }]}>
        <Text accessibilityRole="header" style={heading}>
          Questions
        </Text>
        {QUESTIONS.map(([question, answer], index) => (
          <View
            key={question}
            style={{
              gap: 4,
              paddingVertical: 10,
              borderBottomWidth: index < QUESTIONS.length - 1 ? 1 : 0,
              borderBottomColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{question}</Text>
            <Text style={styles.bodyText}>{answer}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function PricingPage({ signedIn, onOpen }: { signedIn: boolean; onOpen: (tab: string) => void }) {
  const { wide, column, title } = useLayout();
  return (
    <View>
      <View style={[column, { gap: 12, paddingTop: wide ? 28 : 8 }]}>
        <Text accessibilityRole="header" aria-level={1} style={title}>
          Pricing
        </Text>
        <Text style={{ fontSize: wide ? 18 : 16, lineHeight: wide ? 26 : 23, color: colors.muted, maxWidth: 720 }}>
          Searching is free, and so is one alert. The paid plan tells you about every new match as soon as it is found.
        </Text>
      </View>
      <View style={[column, { gap: 18, paddingVertical: 24 }]}>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 14 }}>
          <View style={{ flex: wide ? 1 : undefined, gap: 8, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>Free</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>$0</Text>
            <Text style={styles.bodyText}>
              Search every source, deals and warnings, building grades, rent-stabilized buildings and market data, no account needed. A free
              account adds saved apartments, shared lists and one alert, by email and on your phone, sent three hours after a match is
              found, up to three a day.
            </Text>
          </View>
          <View style={{ flex: wide ? 1 : undefined, gap: 8, padding: 20, borderRadius: 16, borderWidth: 2, borderColor: colors.ink }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>Paid</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>
              $15<Text style={{ fontSize: 16, fontWeight: '400', color: colors.muted }}> a month</Text>
            </Text>
            <Text style={styles.smallMuted}>or $35 for three months, paid once</Text>
            <Text style={styles.bodyText}>
              Everything in Free, plus every new match and price drop sent as soon as it is found (checked every two hours), by email and on
              your phone, and up to ten alerts.
            </Text>
          </View>
        </View>
        {/* The next step: alerts, which ask a visitor to sign in and a free account to upgrade. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
          <Button onPress={() => onOpen('alerts')}>{signedIn ? 'Set up your alerts' : 'Get a free alert'}</Button>
          {!signedIn && (
            <Pressable accessibilityRole="button" onPress={() => onOpen('more')} style={{ paddingVertical: 6 }}>
              <Text style={styles.linkText}>Create a free account or sign in</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
