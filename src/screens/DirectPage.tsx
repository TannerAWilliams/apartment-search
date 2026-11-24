/**
 * List an apartment on Walkup with no broker fee (server/direct-listings.ts): the owner fills in the apartment and
 * how to reach them; an admin approves it; it shows in search for 60 days, renewable. Admins review here too.
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Chip, Field } from '../components/ui.tsx';
import { formatRent } from '../search.ts';
import { styles } from '../styles.ts';

type Input = {
  address: string;
  unit: string;
  zip: string;
  bedrooms: number;
  rent: number;
  available: string;
  description: string;
  email: string;
  phone: string;
};
export type DirectEntry = {
  id: string;
  owner: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  approvedAt?: string;
  input: Input;
};
export type DirectReply = { mine?: DirectEntry[]; pending?: DirectEntry[]; entry?: DirectEntry | null };
export type DirectRequest = (body?: Record<string, unknown>) => Promise<DirectReply>;

const STATUS = { pending: 'Waiting for review', approved: 'Live in search', rejected: 'Not approved' };
const BEDS: [number, string][] = [
  [0, 'Studio'],
  [1, '1 BR'],
  [2, '2 BR'],
  [3, '3 BR'],
  [4, '4 BR'],
];
const empty = { address: '', unit: '', zip: '', rent: '', available: '', description: '', email: '', phone: '' };

export function DirectPage({
  request,
  account,
  onError,
}: {
  request?: DirectRequest;
  account: string | null;
  onError: (message: string) => void;
}) {
  const [data, setData] = useState<DirectReply>({});
  const [form, setForm] = useState({ ...empty, email: account ?? '' });
  const [bedrooms, setBedrooms] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    if (!request) return;
    try {
      setData(await request());
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Your listings could not be loaded.');
    }
  }, [request, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(body: Record<string, unknown>, done: string) {
    if (!request) return;
    setBusy(true);
    setNotice('');
    try {
      await request(body);
      setNotice(done);
      await load();
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : 'That did not work.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  const set = (key: keyof typeof empty) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const rent = Number(form.rent);
  const ready = form.address.trim() && /^\d{5}$/.test(form.zip) && rent >= 500 && /\S+@\S+\.\S+/.test(form.email);
  const row = (entry: DirectEntry, review: boolean) => (
    <View key={entry.id} style={[styles.chartCard, { gap: 6 }]}>
      <Text style={styles.fieldLabel}>
        {entry.input.address}
        {entry.input.unit ? `, ${entry.input.unit}` : ''} · {formatRent(entry.input.rent)}
      </Text>
      <Text style={styles.smallMuted}>
        {STATUS[entry.status]}
        {review ? ` · from ${entry.owner}` : ''}
      </Text>
      <View style={styles.chipRow}>
        {review ? (
          <>
            <Button disabled={busy} onPress={() => act({ action: 'approve', id: entry.id }, 'Approved; it is in search now.')}>
              {'Approve ' + entry.input.address}
            </Button>
            <Button secondary disabled={busy} onPress={() => act({ action: 'reject', id: entry.id }, 'Rejected.')}>
              {'Reject ' + entry.input.address}
            </Button>
          </>
        ) : (
          <>
            {entry.status === 'approved' && (
              <Button secondary disabled={busy} onPress={() => act({ action: 'renew', id: entry.id }, 'Renewed for another 60 days.')}>
                Renew for 60 days
              </Button>
            )}
            <Button secondary disabled={busy} onPress={() => act({ action: 'remove', id: entry.id }, 'Taken down.')}>
              {'Take down ' + entry.input.address}
            </Button>
          </>
        )}
      </View>
    </View>
  );
  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          List your apartment
        </Text>
        <Text style={styles.bodyText}>
          Own or manage an apartment in New York City? List it here with no broker fee for renters. It shows in Walkup’s search for 60 days
          after we approve it, and renters email you directly.
        </Text>
      </View>
      {!request ? (
        <Text style={styles.smallMuted}>Sign in to list an apartment.</Text>
      ) : (
        <>
          {(data.pending ?? []).length > 0 && (
            <>
              <Text accessibilityRole="header" style={styles.sectionHeading}>
                Waiting for review
              </Text>
              {(data.pending ?? []).map((entry) => row(entry, true))}
            </>
          )}
          <View style={styles.chartCard}>
            <Field
              label="Street address"
              value={form.address}
              onChangeText={set('address')}
              placeholder="214 Bedford Avenue"
              maxLength={120}
            />
            <Field label="Unit" value={form.unit} onChangeText={set('unit')} placeholder="3R" maxLength={20} />
            <Field
              label="ZIP code"
              value={form.zip}
              onChangeText={(text) => set('zip')(text.replace(/\D/g, ''))}
              keyboardType="number-pad"
              maxLength={5}
            />
            <Text style={styles.fieldLabel}>Bedrooms</Text>
            <View style={styles.chipRow}>
              {BEDS.map(([count, label]) => (
                <Chip key={count} selected={bedrooms === count} onPress={() => setBedrooms(count)}>
                  {label}
                </Chip>
              ))}
            </View>
            <Field
              label="Monthly rent"
              value={form.rent}
              onChangeText={(text) => set('rent')(text.replace(/\D/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
            />
            <Field label="Available" value={form.available} onChangeText={set('available')} placeholder="March 1" maxLength={40} />
            <Field
              label="About the apartment"
              value={form.description}
              onChangeText={set('description')}
              placeholder="Sunny, laundry in building…"
              maxLength={1000}
            />
            <Field label="Email for renters" value={form.email} onChangeText={set('email')} keyboardType="email-address" maxLength={254} />
            <Field label="Phone (optional)" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={30} />
            <Text style={styles.smallMuted}>Listings must follow fair housing law: describe the apartment, never who may live there.</Text>
            <Button
              disabled={busy || !ready}
              onPress={async () => {
                const listing = { ...form, bedrooms, rent, unit: form.unit.trim(), phone: form.phone.trim() };
                if (await act({ action: 'submit', listing }, 'Sent for review. We’ll approve it shortly.'))
                  setForm({ ...empty, email: form.email });
              }}
            >
              Submit for review
            </Button>
          </View>
          {notice !== '' && (
            <Text accessibilityRole="alert" style={styles.bodyText}>
              {notice}
            </Text>
          )}
          {(data.mine ?? []).length > 0 && (
            <>
              <Text accessibilityRole="header" style={styles.sectionHeading}>
                Your listings
              </Text>
              {(data.mine ?? []).map((entry) => row(entry, false))}
            </>
          )}
        </>
      )}
    </View>
  );
}
