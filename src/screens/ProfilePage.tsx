/**
 * The profile: the account, its saved listings and email alerts, and links to the rest of the app. Admins also get
 * the platform's settings: the nightly resync switch and the sources page.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Button } from '../components/ui.tsx';
import { colors, styles } from '../styles.ts';

export type PlatformSettings = {
  nightlyResync: boolean;
  lastNightly?: { at: string; state: string; updated: number; failed: number; background: boolean };
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
export function lastNightlyText(last: PlatformSettings['lastNightly']) {
  if (!last) return 'It hasn’t run yet.';
  const when = WHEN.format(new Date(last.at));
  const updated = `${last.updated} ${last.updated === 1 ? 'source' : 'sources'} updated`;
  const failed = last.failed ? `, ${last.failed} failed` : '';
  const background = last.background ? '; the slower sources continued in the background' : '';
  return `Last run ${when}: ${updated}${failed}${background}.`;
}

type Row = [key: string, label: string, detail: string];

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
  savedCount,
  onOpen,
  onSignOut,
  settingsRequest,
  onError,
}: {
  account: string | null;
  admin: boolean;
  savedCount: number;
  onOpen: (tab: string) => void;
  onSignOut: () => void;
  settingsRequest?: (body?: { nightlyResync: boolean }) => Promise<PlatformSettings>;
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

  async function setNightly(nightlyResync: boolean) {
    if (!settingsRequest) return;
    setSaving(true);
    try {
      setSettings(await settingsRequest({ nightlyResync }));
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
            <Text style={styles.smallMuted}>{admin ? 'Admin account' : 'Member account'}</Text>
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
          ['alerts', 'Email alerts', 'Hear about new apartments that match, like West Village 2 BR under $5,000'],
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
            <View style={styles.menuRow}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={styles.menuLabel}>Nightly resync</Text>
                <Text style={styles.smallMuted}>
                  Resync every source at 1 AM Eastern, then send alerts.{' '}
                  {settings ? lastNightlyText(settings.lastNightly) : settingsRequest ? 'Loading…' : ''}
                </Text>
              </View>
              <Switch
                accessibilityLabel="Nightly resync"
                aria-label="Nightly resync"
                value={settings?.nightlyResync ?? false}
                disabled={!settings || saving}
                onValueChange={(value) => void setNightly(value)}
                trackColor={{ false: colors.border, true: colors.ink }}
                thumbColor={colors.white}
              />
            </View>
          </View>
          <Menu onOpen={onOpen} rows={[['sources', 'Sources & sync', 'Where listings come from, and resync them now']]} />
        </>
      )}
    </View>
  );
}
