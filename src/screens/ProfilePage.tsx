/**
 * The profile: the account, its saved listings and email alerts, and links to the rest of the app. Admins also get
 * the platform's settings: the nightly resync switch and the sources page.
 */
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Share, Switch, Text, View } from 'react-native';
import { Button, Chip, Field } from '../components/ui.tsx';
import { applyTheme, type ThemeChoice, themeChoice } from '../theme.ts';
import { MenuIcon } from '../components/MenuIcons.tsx';
import { colors, styles } from '../styles.ts';

type Run = { at: string; state: string; updated: number; failed: number; background?: boolean };
export type PlatformSettings = {
  nightlyResync: boolean;
  daytimeChecks: boolean;
  lastNightly?: Run;
  lastDaytime?: Run;
  admin: boolean;
};

const WHEN = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/New_York',
  timeZoneName: 'short',
});

/** What the last nightly resync did, in a line. */
export function lastNightlyText(last: Run | undefined) {
  if (!last) return 'It hasn’t run yet.';
  const when = WHEN.format(new Date(last.at));
  const updated = `${last.updated} ${last.updated === 1 ? 'source' : 'sources'} updated`;
  const failed = last.failed ? `, ${last.failed} failed` : '';
  const background = last.background ? '; the slower sources continued in the background' : '';
  return `Last run ${when}: ${updated}${failed}${background}.`;
}

export type BillingState = {
  available: boolean;
  plans: { monthly: string; pass: string };
  plan?: 'monthly' | 'pass';
  until?: string;
  manage?: boolean;
};
type BillingRequest = (
  body?: { action: 'checkout'; plan: 'monthly' | 'pass' } | { action: 'portal' },
) => Promise<BillingState & { url?: string }>;

/** Opens Stripe's page: in this tab on the web, in the browser in the app. */
function openPage(url: string) {
  if (Platform.OS === 'web') window.location.assign(url);
  else void Linking.openURL(url);
}

/** Light or dark, or whichever the device is set to (the default). Kept on this device (src/theme.ts). */
function Appearance() {
  const [choice, setChoice] = useState<ThemeChoice>(themeChoice);
  return (
    <>
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Appearance
      </Text>
      <View accessibilityRole="radiogroup" style={styles.chipRow}>
        {(
          [
            ['system', 'Match my device'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ] as const
        ).map(([key, label]) => (
          <Chip
            key={key}
            selected={choice === key}
            onPress={() => {
              applyTheme(key);
              setChoice(key);
            }}
          >
            {label}
          </Chip>
        ))}
      </View>
    </>
  );
}

/** The plan: upgrade through Stripe, or when paid, until when and a link to manage the subscription. */
function PlanCard({ plan, request, onError }: { plan: 'free' | 'paid'; request: BillingRequest; onError: (message: string) => void }) {
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request()
      .then(setBilling)
      .catch(() => setBilling(null));
  }, [request]);
  async function go(body: Parameters<BillingRequest>[0]) {
    setBusy(true);
    try {
      const { url } = await request(body);
      if (url) openPage(url);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Payments are unavailable right now.');
    } finally {
      setBusy(false);
    }
  }
  if (!billing) return null;
  if (billing.until)
    return (
      <View style={[styles.menu, styles.menuRow]}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.menuLabel}>{billing.plan === 'monthly' ? 'Paid monthly' : 'Three-month pass'}</Text>
          <Text style={styles.smallMuted}>
            {billing.plan === 'monthly' ? 'Renews' : 'Paid'} until {new Date(billing.until).toLocaleDateString('en-US')}
          </Text>
        </View>
        {billing.manage && (
          <Button secondary disabled={busy} onPress={() => void go({ action: 'portal' })}>
            Manage billing
          </Button>
        )}
      </View>
    );
  if (plan === 'paid' || !billing.available) return null;
  return (
    <View style={[styles.menu, { padding: 16, gap: 10 }]}>
      <Text style={styles.menuLabel}>Upgrade to hear first</Text>
      <Text style={styles.smallMuted}>
        Every new match and price drop as soon as it is found, checked every two hours, instead of three hours later, and up to ten alerts.
        Cancel anytime; payments are handled by Stripe.
      </Text>
      <View style={styles.chipRow}>
        <Button disabled={busy} onPress={() => void go({ action: 'checkout', plan: 'monthly' })}>
          {billing.plans.monthly}
        </Button>
        <Button secondary disabled={busy} onPress={() => void go({ action: 'checkout', plan: 'pass' })}>
          {billing.plans.pass}
        </Button>
      </View>
    </View>
  );
}

/** Download everything kept for the account, or delete the account after typing DELETE. */
function YourData({
  request,
  onSignOut,
  onError,
}: {
  request: (body?: { action: 'delete'; confirm: 'DELETE' }) => Promise<Record<string, unknown>>;
  onSignOut: () => void;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const text = JSON.stringify(await request(), null, 2);
      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        link.download = 'walkup-account.json';
        link.click();
        URL.revokeObjectURL(link.href);
      } else await Share.share({ message: text });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Your data could not be downloaded.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await request({ action: 'delete', confirm: 'DELETE' });
      onSignOut();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Your account could not be deleted.');
      setBusy(false);
    }
  }
  return (
    <>
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Your data
      </Text>
      <View style={[styles.menu, { padding: 16, gap: 10 }]}>
        <Text style={styles.smallMuted}>
          Download everything Walkup keeps for your account, or delete your account and all of it. Your application kit, tours and notes
          stay on this device.
        </Text>
        <View style={styles.chipRow}>
          <Button secondary disabled={busy} onPress={() => void download()}>
            Download my data
          </Button>
          {!confirming && (
            <Button secondary disabled={busy} onPress={() => setConfirming(true)}>
              Delete my account
            </Button>
          )}
        </View>
        {confirming && (
          <>
            <Text style={styles.bodyText}>
              This removes your saved apartments, alerts, notification devices, shared-list membership and sign-in. It can’t be undone.
            </Text>
            <Field label="Type DELETE to confirm" value={typed} onChangeText={setTyped} maxLength={6} placeholder="DELETE" />
            <View style={styles.chipRow}>
              <Button dark disabled={busy || typed !== 'DELETE'} onPress={() => void remove()}>
                Delete my account for good
              </Button>
              <Button
                secondary
                disabled={busy}
                onPress={() => {
                  setConfirming(false);
                  setTyped('');
                }}
              >
                Keep my account
              </Button>
            </View>
          </>
        )}
      </View>
    </>
  );
}

export type SettingsChange = { nightlyResync?: boolean; daytimeChecks?: boolean };
export type Member = { email: string; admin: boolean; paid: boolean };

type Row = [key: string, label: string, detail: string];

/** Accounts and their plans; an admin switches each between free and paid. Admins are always paid. */
function Members({
  request,
  onError,
}: {
  request: (body?: { email: string; paid: boolean }) => Promise<{ members: Member[] }>;
  onError: (message: string) => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    request()
      .then(({ members }) => setMembers(members))
      .catch((error) => onError(error instanceof Error ? error.message : 'Accounts could not be loaded.'));
  }, [request, onError]);
  async function change(email: string, paid: boolean) {
    setBusy(email);
    try {
      setMembers((await request({ email, paid })).members);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The plan could not be changed.');
    } finally {
      setBusy('');
    }
  }
  if (!members) return <Text style={styles.smallMuted}>Loading accounts…</Text>;
  return (
    <View style={styles.menu}>
      {members.map(({ email, admin, paid }, index) => (
        <View key={email} style={[styles.menuRow, index > 0 && styles.menuDivider]}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.menuLabel} numberOfLines={1}>
              {email}
            </Text>
            <Text style={styles.smallMuted}>{admin ? 'Admin · always paid' : paid ? 'Paid plan' : 'Free plan'}</Text>
          </View>
          <Switch
            accessibilityLabel={`Paid plan for ${email}`}
            aria-label={`Paid plan for ${email}`}
            value={paid}
            disabled={admin || busy !== ''}
            onValueChange={(value) => void change(email, value)}
            trackColor={{ false: colors.border, true: colors.ink }}
            thumbColor={colors.white}
          />
        </View>
      ))}
    </View>
  );
}

function Menu({ rows, onOpen }: { rows: Row[]; onOpen: (key: string) => void }) {
  return (
    <View style={styles.menu}>
      {rows.map(([key, label, detail], index) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() => onOpen(key)}
          style={({ pressed }) => [styles.menuRow, index > 0 && styles.menuDivider, pressed && styles.pressed]}
        >
          <MenuIcon name={key} color={colors.ink} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.menuLabel}>{label}</Text>
            <Text style={styles.smallMuted}>{detail}</Text>
          </View>
          <Text style={styles.menuChevron}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ProfilePage({
  account,
  admin,
  plan,
  billingRequest,
  accountRequest,
  membersRequest,
  savedCount,
  onOpen,
  onSignOut,
  settingsRequest,
  onError,
  signInCard,
  commuteCard,
}: {
  /** Where the person commutes to, set once for every search. */
  commuteCard?: ReactNode;
  /** For a visitor: creating an account, above the tools that work without one. */
  signInCard?: ReactNode;
  account: string | null;
  admin: boolean;
  plan: 'free' | 'paid';
  billingRequest?: BillingRequest;
  accountRequest?: (body?: { action: 'delete'; confirm: 'DELETE' }) => Promise<Record<string, unknown>>;
  membersRequest?: (body?: { email: string; paid: boolean }) => Promise<{ members: Member[] }>;
  savedCount: number;
  onOpen: (tab: string) => void;
  onSignOut: () => void;
  settingsRequest?: (body?: SettingsChange) => Promise<PlatformSettings>;
  onError: (message: string) => void;
}) {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    if (!settingsRequest || !admin) return;
    try {
      setSettings(await settingsRequest());
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Settings could not be loaded.');
    }
  }, [settingsRequest, admin, onError]);
  useEffect(() => {
    void load();
  }, [load]);

  async function change(body: SettingsChange) {
    if (!settingsRequest) return;
    setSaving(true);
    try {
      setSettings(await settingsRequest(body));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The setting could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
      {/* A visitor's page opens on signing in; its own heading says so. */}
      {!signInCard && (
        <Text accessibilityRole="header" style={styles.panelTitle}>
          Profile
        </Text>
      )}
      {signInCard}
      {account && (
        <View style={[styles.menu, styles.menuRow]}>
          <View
            aria-hidden
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: colors.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.white, fontSize: 20, fontWeight: '600' }}>{account.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={styles.menuLabel} numberOfLines={1}>
              {account}
            </Text>
            <Text style={styles.smallMuted}>{admin ? 'Admin account' : plan === 'paid' ? 'Paid plan' : 'Free plan'}</Text>
          </View>
          <Button secondary onPress={onSignOut}>
            Sign out
          </Button>
        </View>
      )}
      {account && billingRequest && !admin && <PlanCard plan={plan} request={billingRequest} onError={onError} />}
      {commuteCard && (
        <>
          <Text accessibilityRole="header" style={styles.fieldLabel}>
            Your commute
          </Text>
          {commuteCard}
        </>
      )}
      {Platform.OS === 'web' && <Appearance />}
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Your apartments
      </Text>
      <Menu
        onOpen={onOpen}
        rows={[
          [
            'saved',
            `Saved listings (${savedCount})`,
            account
              ? 'Kept on your account, on every device you sign in on'
              : signInCard
                ? 'Sign in to save apartments'
                : 'Kept on this device',
          ],
          ['afford', 'What can I afford?', 'Landlords’ 40× rule and Dave Ramsey’s 25% of take-home pay'],
          ['apply', 'Application kit', 'Your renter profile, the income rule, documents and a ready-written message'],
          ['shared', 'Shared list', 'Search with a partner or roommates: share apartments, vote and leave notes'],
          [
            'alerts',
            'Email alerts',
            plan === 'paid'
              ? 'Hear about new apartments that match, like West Village 2 BR under $5,000'
              : 'One alert on the free plan; every match at once on the paid plan',
          ],
        ]}
      />
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Explore
      </Text>
      <Menu
        onOpen={onOpen}
        rows={[
          ['list', 'List your apartment', 'Owners and managers: list a no-fee apartment, renters email you directly'],
          ['neighborhoods', 'Neighborhoods', 'Rents by size, buildings and 311 complaints for any NYC neighborhood'],
          ['renewal', 'Renewal check', 'What your apartment would rent for today, before you renew'],
          ['marketplaces', 'Rental platforms', 'Search StreetEasy, Zillow and other sites directly'],
        ]}
      />
      {admin && (
        <>
          <Text accessibilityRole="header" style={styles.fieldLabel}>
            Admin
          </Text>
          <View style={styles.menu}>
            {(
              [
                ['nightlyResync', 'Nightly resync', 'Resync every source at 1 AM Eastern, then send alerts.', settings?.lastNightly],
                [
                  'daytimeChecks',
                  'Daytime checks',
                  'Check the quick sources every two hours from 8 AM to 10 PM Eastern, then send alerts.',
                  settings?.lastDaytime,
                ],
              ] as const
            ).map(([key, label, detail, last], index) => (
              <View key={key} style={[styles.menuRow, index > 0 && styles.menuDivider]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={styles.menuLabel}>{label}</Text>
                  <Text style={styles.smallMuted}>
                    {detail} {settings ? lastNightlyText(last) : settingsRequest ? 'Loading…' : ''}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={label}
                  aria-label={label}
                  value={settings?.[key] ?? false}
                  disabled={!settings || saving}
                  onValueChange={(value) => void change({ [key]: value })}
                  trackColor={{ false: colors.border, true: colors.ink }}
                  thumbColor={colors.white}
                />
              </View>
            ))}
          </View>
          <Menu
            onOpen={onOpen}
            rows={[
              ['admin', 'Dashboard', 'Members, payments, alerts, sources and runs'],
              ['sources', 'Sources & sync', 'Where listings come from, and resync them now'],
            ]}
          />
          {account && membersRequest && (
            <>
              <Text accessibilityRole="header" style={styles.fieldLabel}>
                Accounts and plans
              </Text>
              <Members request={membersRequest} onError={onError} />
            </>
          )}
        </>
      )}
      {account && accountRequest && <YourData request={accountRequest} onSignOut={onSignOut} onError={onError} />}
      <View style={[styles.chipRow, { justifyContent: 'center' }]}>
        <Pressable accessibilityRole="link" onPress={() => onOpen('terms')}>
          <Text style={styles.linkText}>Terms of Service</Text>
        </Pressable>
        <Text style={styles.smallMuted}>·</Text>
        <Pressable accessibilityRole="link" onPress={() => onOpen('privacy')}>
          <Text style={styles.linkText}>Privacy Policy</Text>
        </Pressable>
      </View>
    </View>
  );
}
