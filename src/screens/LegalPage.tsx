/**
 * Terms of Service and Privacy Policy. These are drafts written from what the app actually does; have a lawyer
 * review them before charging customers (see TODO.md), and set CONTACT_EMAIL.
 */
import { Text, View } from 'react-native';
import { styles } from '../styles.ts';

/** Where people reach the business about their account, privacy or these terms. Set before launch. */
export const CONTACT_EMAIL = '';
const contact = CONTACT_EMAIL || 'the contact address on this page once it is published';
const UPDATED = 'November 24, 2026';

type Section = [heading: string, ...paragraphs: string[]];

export const TERMS: Section[] = [
  [
    'What Walkup is',
    'Walkup helps you search for rental apartments. It gathers listings published by landlords, management companies, brokerages and other sites, adds public records about buildings, and lets you save apartments, set alerts and share lists.',
    'Walkup is not a landlord, broker or agent, and is not a party to any lease. Listings belong to the people who publish them.',
  ],
  [
    'Listings and information',
    'Listings, prices, availability and building information come from third parties and public records and can be wrong, out of date or incomplete. Price comparisons, grades, costs and other estimates are for guidance only. Confirm everything with the landlord or their agent before you rely on it, and never send money for an apartment you have not seen with a lease you have not read.',
  ],
  [
    'Your account',
    'You sign in with a code sent to your email. Keep access to that email to yourself. You can download your data or delete your account from your Profile at any time.',
  ],
  [
    'Paid plan',
    'The paid plan adds email alerts. It is billed through Stripe either monthly, renewing until you cancel, or as a one-time payment for three months. You can cancel a subscription at any time from your Profile; it stays active until the end of the period you paid for. Prices are shown before you pay. Except where the law requires otherwise, payments are not refunded.',
  ],
  [
    'Fair use',
    'Use Walkup for your own apartment search. Do not copy its data in bulk, collect it by automated means (scraping or crawling), republish it, resell it, use it to train models, interfere with the service, or use it to discriminate against anyone. Housing discrimination is illegal under federal, state and New York City law.',
  ],
  [
    'Availability and liability',
    'We work to keep Walkup running and accurate, but it is provided as is, without warranties, and may change or be unavailable. To the extent the law allows, Walkup is not liable for decisions you make based on it, and its liability is limited to what you paid in the last twelve months.',
  ],
  [
    'Changes',
    'We may update these terms; the date above shows the latest version. Continuing to use Walkup after a change means you accept it.',
  ],
  ['Contact', `Questions about these terms: ${contact}.`],
];

export const PRIVACY: Section[] = [
  [
    'What we keep',
    'Your email address, which is your account. The apartments you save, your alerts and the devices you turn notifications on for, your shared list (its members, votes, notes and the places you commute to), and your plan and payment status.',
    'Stripe handles payments; we never see or store card numbers. We keep the Stripe customer reference and the date you are paid until.',
  ],
  [
    'What stays on your device',
    'Your application kit (renter profile, income and documents checklist), tour plans and private notes are stored only on your device and never sent to us.',
  ],
  [
    'How we use it',
    'To run the service: sign you in, keep your saved apartments and shared list, and send the alerts you ask for. We do not sell your information or use it for advertising.',
  ],
  [
    'Who else handles it',
    'Cloudflare hosts the app, its database and email delivery. Stripe processes payments. Searches that need a place looked up are sent to OpenStreetMap; map images come from OpenStreetMap and, when enabled, Google Street View. Building records come from New York City and New York State open data. These services receive only what they need.',
  ],
  [
    'How long we keep it',
    'Until you delete it or your account. Deleting your account removes your saved apartments, alerts, devices, shared-list membership and sign-in.',
  ],
  [
    'Your choices',
    'Download everything we keep for your account, or delete your account, from your Profile at any time. You can also turn notifications off in your browser or phone settings.',
  ],
  ['Contact', `Privacy questions or requests: ${contact}.`],
];

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const sections = kind === 'terms' ? TERMS : PRIVACY;
  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          {kind === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
        </Text>
        <Text style={styles.smallMuted}>Last updated {UPDATED}</Text>
      </View>
      {sections.map(([heading, ...paragraphs]) => (
        <View key={heading} style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={styles.fieldLabel}>
            {heading}
          </Text>
          {paragraphs.map((paragraph) => (
            <Text key={paragraph.slice(0, 40)} style={styles.bodyText}>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
