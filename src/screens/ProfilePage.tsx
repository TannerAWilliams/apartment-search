/**
 * The profile: the account, its saved listings and email alerts, and links to the rest of the app. Admins also get
 * the platform's settings: the nightly resync switch and the sources page.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Button } from '../components/ui.tsx';
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
  membersRequest,
  savedCount,
  onOpen,
  onSignOut,
  settingsRequest,
  onError,
}: {
  account: string | null;
  admin: boolean;
  plan: 'free' | 'paid';
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
      <Text accessibilityRole="header" style={styles.panelTitle}>
        Profile
      </Text>
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
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Your apartments
      </Text>
      <Menu
        onOpen={onOpen}
        rows={[
          [
            'saved',
            `Saved listings (${savedCount})`,
            account ? 'Kept on your account, on every device you sign in on' : 'Kept on this device',
          ],
          [
            'alerts',
            'Email alerts',
            plan === 'paid' ? 'Hear about new apartments that match, like West Village 2 BR under $5,000' : 'Part of the paid plan',
          ],
        ]}
      />
      <Text accessibilityRole="header" style={styles.fieldLabel}>
        Explore
      </Text>
      <Menu
        onOpen={onOpen}
        rows={[
          ['affordable', 'Affordable housing', 'Open lotteries and income-restricted rentals'],
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
          <Menu onOpen={onOpen} rows={[['sources', 'Sources & sync', 'Where listings come from, and resync them now']]} />
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
    </View>
  );
}
