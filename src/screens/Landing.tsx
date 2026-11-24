/**
 * The landing page, for anyone not signed in: what Walkup does, an example of what a listing shows, how it works,
 * the plans and common questions, with sign-in at the top and the bottom. Terms and privacy open in place.
 */
import type React from 'react';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { BrandMark } from '../components/Icons.tsx';
import { ListingThumbnail } from '../components/ListingThumbnail.tsx';
import { SignIn } from '../components/SignIn.tsx';
import { colors, styles } from '../styles.ts';
import { LegalPage } from './LegalPage.tsx';

const FEATURES: [title: string, body: string][] = [
  ['Every listing, one search', 'Walkup reads more than 40 listing sites, brokerages and landlords, so you stop checking ten apps.'],
  ['Know a deal when you see it', 'Every rent is compared with similar apartments nearby, so “12% below similar” means something.'],
  ['Rent-stabilized buildings', 'Built from New York State’s list of about 57,000 registered buildings, with a filter for them.'],
  ['Buildings graded A to D', 'Open violations, complaints, bedbug filings and flood zones from city records, before you tour.'],
  ['Alerts within hours', 'New matches are checked every two hours from 8 AM to 10 PM, so you hear first, not the next morning.'],
  ['Search together', 'Share a list with a partner or roommates, vote, leave notes and see everyone’s commute.'],
];
const STEPS: [title: string, body: string][] = [
  ['Describe it', '“2 bedroom in Park Slope under $4k near the F.” Or use the filters.'],
  ['Compare honestly', 'Price against the neighborhood, the building’s record, the subway, the real monthly cost.'],
  ['Move first', 'Get an alert, send a ready-written message from your application kit, plan the tour.'],
];
const QUESTIONS: [question: string, answer: string][] = [
  ['Is Walkup a broker?', 'No. Walkup is a search tool; it never charges a broker fee and doesn’t represent landlords.'],
  [
    'Where do listings come from?',
    'Landlords, management companies, brokerages and listing sites, plus city and state open data about buildings.',
  ],
  ['Can I cancel?', 'Yes, anytime from your Profile. The three-month pass doesn’t renew.'],
  ['What does it cost?', 'Search, saved apartments, building grades and market data are free. Email alerts are part of the paid plan.'],
];

/** An example card with the badges Walkup adds, drawn with the app's own styles. */
function ExampleCard() {
  const tags = ['New today', '3 min to L', 'Rent-stabilized building', 'Building A'];
  return (
    <View
      aria-hidden
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: colors.white,
        borderWidth: 1,
        borderColor: colors.border,
        maxWidth: 380,
        width: '100%',
      }}
    >
      <View
        style={{
          height: 170,
          backgroundColor: colors.light,
          padding: 12,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
          alignContent: 'flex-start',
        }}
      >
        <ListingThumbnail latitude={40.7172} longitude={-73.9567} />
        {tags.map((tag) => (
          <Text
            key={tag}
            style={{
              fontSize: 12,
              fontWeight: '600',
              color: colors.ink,
              backgroundColor: colors.white,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            {tag}
          </Text>
        ))}
      </View>
      <View style={{ padding: 14, gap: 3 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>214 Bedford Avenue, Unit 3R</Text>
        <Text style={styles.smallMuted}>Williamsburg · Brooklyn</Text>
        <Text style={{ fontSize: 16, color: colors.ink }}>
          <Text style={{ fontWeight: '600' }}>$3,450</Text> month
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>12% below similar · median $3,920 for 28 nearby</Text>
        <Text style={styles.smallMuted}>About $3,690 a month all in · no broker fee under the FARE Act</Text>
      </View>
    </View>
  );
}

export function Landing({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [page, setPage] = useState<'home' | 'terms' | 'privacy'>('home');
  const scroll = useRef<React.ElementRef<typeof ScrollView>>(null);
  const toTop = () => scroll.current?.scrollTo({ y: 0, animated: true });
  const column = { width: '100%', maxWidth: 1080, alignSelf: 'center', paddingHorizontal: 20 } as const;
  const heading = {
    fontSize: wide ? 30 : 24,
    lineHeight: wide ? 36 : 30,
    fontWeight: '600',
    color: colors.ink,
    letterSpacing: -0.5,
  } as const;

  const signIn = (
    <View style={[styles.signInCard, { marginTop: 0 }]}>
      <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '600', color: colors.ink }}>
        Sign in or join
      </Text>
      <Text style={styles.smallMuted}>Enter your email and we’ll send a six-digit code. No password needed.</Text>
      <SignIn onSignedIn={onSignedIn} primary />
    </View>
  );

  return (
    <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 40, backgroundColor: colors.background }}>
      <View style={[column, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 }]}>
        <Pressable accessibilityRole="link" accessibilityLabel="Walkup, home" onPress={() => setPage('home')} style={styles.brand}>
          <BrandMark />
          <Text style={styles.brandText}>walkup</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setPage('home');
            toTop();
          }}
          style={{ borderWidth: 1, borderColor: colors.ink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ fontWeight: '600', color: colors.ink }}>Log in</Text>
        </Pressable>
      </View>

      {page !== 'home' ? (
        <View style={column}>
          <Pressable accessibilityRole="button" onPress={() => setPage('home')} style={{ paddingVertical: 8 }}>
            <Text style={styles.linkText}>← Back</Text>
          </Pressable>
          <LegalPage kind={page} />
        </View>
      ) : (
        <>
          <View
            style={[
              column,
              { flexDirection: wide ? 'row' : 'column', gap: 28, paddingVertical: wide ? 48 : 20, alignItems: wide ? 'center' : 'stretch' },
            ]}
          >
            <View style={{ flex: wide ? 1.1 : undefined, gap: 16 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 1, color: colors.green }}>NEW YORK CITY APARTMENTS</Text>
              <Text
                accessibilityRole="header"
                aria-level={1}
                style={{ fontSize: wide ? 52 : 36, lineHeight: wide ? 58 : 42, fontWeight: '700', color: colors.ink, letterSpacing: -1.2 }}
              >
                Find the good apartment before everyone else does.
              </Text>
              <Text style={{ fontSize: wide ? 19 : 17, lineHeight: wide ? 28 : 25, color: colors.muted }}>
                Walkup searches the whole city’s listings in one place, tells you which are a real deal, which buildings are well kept or
                rent-stabilized, and alerts you within hours.
              </Text>
              {signIn}
              {wide ? null : <ExampleCard />}
            </View>
            {wide && (
              <View style={{ flex: 1, alignItems: 'center' }}>
                <ExampleCard />
              </View>
            )}
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

          <View style={[column, { gap: 18, paddingVertical: 24 }]}>
            <Text accessibilityRole="header" style={heading}>
              How it works
            </Text>
            <View style={{ flexDirection: wide ? 'row' : 'column', gap: 18 }}>
              {STEPS.map(([title, body], index) => (
                <View key={title} style={{ flex: wide ? 1 : undefined, flexDirection: 'row', gap: 12 }}>
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 17,
                      backgroundColor: colors.ink,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: colors.white, fontWeight: '700' }}>{index + 1}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>{title}</Text>
                    <Text style={styles.bodyText}>{body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={[column, { gap: 18, paddingVertical: 24 }]}>
            <Text accessibilityRole="header" style={heading}>
              Plans
            </Text>
            <View style={{ flexDirection: wide ? 'row' : 'column', gap: 14 }}>
              <View
                style={{ flex: wide ? 1 : undefined, gap: 8, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>Free</Text>
                <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>$0</Text>
                <Text style={styles.bodyText}>
                  Search every source, deals and warnings, building grades, rent-stabilized buildings, market data, saved apartments, shared
                  lists and the application kit.
                </Text>
              </View>
              <View style={{ flex: wide ? 1 : undefined, gap: 8, padding: 20, borderRadius: 16, borderWidth: 2, borderColor: colors.ink }}>
                <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>Paid</Text>
                <Text style={{ fontSize: 28, fontWeight: '700', color: colors.ink }}>
                  $15<Text style={{ fontSize: 16, fontWeight: '400', color: colors.muted }}> a month</Text>
                </Text>
                <Text style={styles.smallMuted}>or $35 for three months, paid once</Text>
                <Text style={styles.bodyText}>
                  Everything in Free, plus email alerts for new matches and price drops, checked every two hours, for as many searches as
                  you need.
                </Text>
              </View>
            </View>
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

          <View style={[column, { alignItems: 'center', gap: 14, paddingVertical: 32 }]}>
            <Text style={[heading, { textAlign: 'center' }]}>Ready to look?</Text>
            <Pressable
              accessibilityRole="button"
              onPress={toTop}
              style={{ backgroundColor: colors.green, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 14 }}
            >
              <Text style={{ color: colors.white, fontWeight: '600', fontSize: 16 }}>Start searching</Text>
            </Pressable>
          </View>
        </>
      )}

      <View
        style={[
          column,
          {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 16,
            justifyContent: 'center',
            paddingTop: 20,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          },
        ]}
      >
        <Text style={styles.smallMuted}>© {new Date().getFullYear()} Walkup · New York</Text>
        <Pressable accessibilityRole="link" onPress={() => (setPage('terms'), toTop())}>
          <Text style={styles.linkText}>Terms of Service</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => (setPage('privacy'), toTop())}>
          <Text style={styles.linkText}>Privacy Policy</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
