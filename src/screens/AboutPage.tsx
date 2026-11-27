/**
 * What Walkup is (/about) and what it costs (/pricing): the pages the home page, which is only the search, links
 * to. Each ends on the next step: searching, or an account.
 */
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Button } from '../components/ui.tsx';
import { ABOUT_INTRO, FEATURES, PRICING, QUESTIONS } from '../about-copy.ts';
import { colors, styles } from '../styles.ts';

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
        <Text style={{ fontSize: wide ? 18 : 16, lineHeight: wide ? 26 : 23, color: colors.muted, maxWidth: 720 }}>{ABOUT_INTRO}</Text>
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
        <Text style={{ fontSize: wide ? 18 : 16, lineHeight: wide ? 26 : 23, color: colors.muted, maxWidth: 720 }}>{PRICING.intro}</Text>
      </View>
      <View style={[column, { gap: 18, paddingVertical: 24 }]}>
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: 14 }}>
          <View style={{ flex: wide ? 1 : undefined, gap: 8, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>Free</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>$0</Text>
            <Text style={styles.bodyText}>{PRICING.free}</Text>
          </View>
          <View style={{ flex: wide ? 1 : undefined, gap: 8, padding: 20, borderRadius: 16, borderWidth: 2, borderColor: colors.ink }}>
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>Paid</Text>
            <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>
              $15<Text style={{ fontSize: 16, fontWeight: '400', color: colors.muted }}> a month</Text>
            </Text>
            <Text style={styles.smallMuted}>{PRICING.pass}</Text>
            <Text style={styles.bodyText}>{PRICING.paid}</Text>
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
