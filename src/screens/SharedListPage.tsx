/**
 * The shared list, for couples and roommates (server/households.ts): invite someone by email; once they accept,
 * you both add apartments from your saved ones, vote yes or no on each and leave notes.
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { ListingData } from '../domain.ts';
import { listingLinkLabel, orderedListingLinks } from '../listings.ts';
import { bedroomLabel, directionsLink, distanceMiles, formatRent } from '../search.ts';
import { styles } from '../styles.ts';
import { Button, Field, Link } from '../components/ui.tsx';

export type Household = {
  id: string;
  members: string[];
  invited: string[];
  listings: ListingData[];
  votes: Record<string, Record<string, 'yes' | 'no'>>;
  notes: Record<string, { by: string; text: string; at: string }[]>;
  workplaces?: Record<string, Place>;
};
type Place = { label: string; latitude: number; longitude: number };
export type HouseholdReply = { household: Household | null; me: string };
export type HouseholdRequest = (body?: Record<string, unknown>) => Promise<HouseholdReply>;

const name = (email: string) => email.split('@')[0];
const title = (listing: ListingData) => (listing.unit ? `${listing.address}, Unit ${listing.unit}` : listing.address);

export function SharedListPage({
  request,
  saved,
  lookUp,
  onError,
}: {
  request?: HouseholdRequest;
  saved: ListingData[];
  /** Finds a typed place: the same OpenStreetMap lookup as the commute destination. */
  lookUp?: (place: string) => Promise<Place>;
  onError: (message: string) => void;
}) {
  const [work, setWork] = useState('');
  const [reply, setReply] = useState<HouseholdReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const act = useCallback(
    async (body?: Record<string, unknown>) => {
      if (!request) return;
      setBusy(true);
      try {
        setReply(await request(body));
        return true;
      } catch (error) {
        onError(error instanceof Error ? error.message : 'The shared list could not be updated.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [request, onError],
  );
  useEffect(() => {
    void act();
  }, [act]);

  const intro = (
    <View style={styles.chartIntro}>
      <Text accessibilityRole="header" style={styles.chartTitle}>
        Shared list
      </Text>
      <Text style={styles.bodyText}>
        Search together with a partner or roommates: share apartments, vote on each and leave notes for each other.
      </Text>
    </View>
  );
  if (!request)
    return (
      <View style={styles.marketplacePanel}>
        {intro}
        <Text style={styles.smallMuted}>Sign in to share a list.</Text>
      </View>
    );
  if (!reply)
    return (
      <View style={styles.marketplacePanel}>
        {intro}
        <Text style={styles.smallMuted}>Loading…</Text>
      </View>
    );
  const { household, me } = reply;
  const member = household?.members.includes(me) ?? false;
  const inviteForm = (
    <View style={styles.chartCard}>
      <Field label="Invite by email" value={email} onChangeText={setEmail} placeholder="partner@example.com" keyboardType="email-address" />
      <Text style={styles.smallMuted}>They need a Walkup account with that email; they’ll see your invitation on their shared list.</Text>
      <Button
        disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
        onPress={async () => {
          if (await act({ action: 'invite', email: email.trim() })) setEmail('');
        }}
      >
        Send invitation
      </Button>
    </View>
  );
  if (!household)
    return (
      <View style={styles.marketplacePanel}>
        {intro}
        {inviteForm}
      </View>
    );
  if (!member)
    return (
      <View style={styles.marketplacePanel}>
        {intro}
        <View style={styles.chartCard}>
          <Text style={styles.bodyText}>{household.members.map(name).join(' and ')} invited you to their shared list.</Text>
          <View style={styles.chipRow}>
            <Button disabled={busy} onPress={() => act({ action: 'accept' })}>
              Join the shared list
            </Button>
            <Button secondary disabled={busy} onPress={() => act({ action: 'leave' })}>
              Decline
            </Button>
          </View>
        </View>
      </View>
    );
  const shared = new Set(household.listings.map(({ id }) => id));
  const workplaces = household.workplaces ?? {};
  const commutes = Object.entries(workplaces).filter(([who]) => household.members.includes(who));
  async function setWorkplace() {
    if (!lookUp) return;
    setBusy(true);
    try {
      const place = await lookUp(work.trim());
      if (
        await act({
          action: 'workplace',
          workplace: { label: place.label.slice(0, 160), latitude: place.latitude, longitude: place.longitude },
        })
      )
        setWork('');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'That place could not be found.');
    } finally {
      setBusy(false);
    }
  }
  const addable = saved.filter(({ id }) => !shared.has(id));
  return (
    <View style={styles.marketplacePanel}>
      {intro}
      <Text style={styles.smallMuted}>
        With{' '}
        {household.members
          .filter((item) => item !== me)
          .map(name)
          .join(', ') || 'nobody yet'}
        {household.invited.length ? ` · invited: ${household.invited.join(', ')}` : ''}
      </Text>
      {household.listings.length === 0 && <Text style={styles.bodyText}>No apartments yet. Add some from your saved ones below.</Text>}
      {household.listings.map((listing) => {
        const votes = household.votes[listing.id] ?? {};
        const mine = votes[me];
        const [original] = orderedListingLinks(listing.sources ?? []);
        const notes = household.notes[listing.id] ?? [];
        return (
          <View key={listing.id} style={styles.chartCard}>
            <Text accessibilityRole="header" style={styles.fieldLabel}>
              {title(listing)}
            </Text>
            <Text style={styles.smallMuted}>
              {formatRent(listing.rent)} · {bedroomLabel(listing.bedrooms)} · {listing.city}
            </Text>
            {original?.url ? <Link label={listingLinkLabel(original)} url={original.url} onError={onError} /> : null}
            {commutes.map(([who, place]) => {
              const miles = distanceMiles(listing, place);
              return (
                <View key={who} style={styles.chipRow}>
                  <Text style={styles.smallMuted}>
                    {name(who)} to {place.label.split(',')[0]}: {miles === null ? 'distance unknown' : `${miles.toFixed(1)} mi`}
                  </Text>
                  <Link label={`${name(who)}’s transit directions`} url={directionsLink(listing, place)} onError={onError} />
                </View>
              );
            })}
            <Text style={styles.bodyText}>
              {Object.keys(votes).length
                ? Object.entries(votes)
                    .map(([who, vote]) => `${name(who)}: ${vote === 'yes' ? 'yes' : 'no'}`)
                    .join(' · ')
                : 'No votes yet'}
            </Text>
            <View style={styles.chipRow}>
              {(['yes', 'no'] as const).map((vote) => (
                <Button
                  key={vote}
                  secondary={mine !== vote}
                  dark={mine === vote}
                  disabled={busy}
                  onPress={() => act({ action: 'vote', id: listing.id, vote: mine === vote ? null : vote })}
                >
                  {vote === 'yes' ? `Yes to ${listing.address}` : `No to ${listing.address}`}
                </Button>
              ))}
            </View>
            {notes.map((note) => (
              <Text key={note.at + note.by} style={styles.smallMuted}>
                {name(note.by)}: {note.text}
              </Text>
            ))}
            <Field
              label={`Note on ${listing.address}`}
              value={drafts[listing.id] ?? ''}
              onChangeText={(text) => setDrafts((current) => ({ ...current, [listing.id]: text }))}
              maxLength={500}
              placeholder="Great light, small kitchen…"
            />
            <View style={styles.chipRow}>
              <Button
                secondary
                disabled={busy || !(drafts[listing.id] ?? '').trim()}
                onPress={async () => {
                  if (await act({ action: 'note', id: listing.id, text: drafts[listing.id] }))
                    setDrafts((current) => ({ ...current, [listing.id]: '' }));
                }}
              >
                Add note
              </Button>
              <Button secondary disabled={busy} onPress={() => act({ action: 'remove', id: listing.id })}>
                {'Remove ' + listing.address}
              </Button>
            </View>
          </View>
        );
      })}
      {addable.length > 0 && (
        <View style={styles.chartCard}>
          <Text accessibilityRole="header" style={styles.fieldLabel}>
            Add from your saved apartments
          </Text>
          {addable.map((listing) => (
            <View key={listing.id} style={styles.chipRow}>
              <Text style={[styles.bodyText, { flex: 1 }]}>
                {title(listing)} · {formatRent(listing.rent)}
              </Text>
              <Button secondary disabled={busy} onPress={() => act({ action: 'add', listing })}>
                {'Share ' + listing.address}
              </Button>
            </View>
          ))}
        </View>
      )}
      <View style={styles.chartCard}>
        <Text accessibilityRole="header" style={styles.fieldLabel}>
          Where each of you commutes
        </Text>
        {commutes.length ? (
          commutes.map(([who, place]) => (
            <Text key={who} style={styles.smallMuted}>
              {name(who)}: {place.label}
            </Text>
          ))
        ) : (
          <Text style={styles.smallMuted}>Add your work or school, and each apartment shows everyone’s trip.</Text>
        )}
        <Field label="Your work or school" value={work} onChangeText={setWork} placeholder="Rockefeller Center" maxLength={160} />
        <View style={styles.chipRow}>
          <Button secondary disabled={busy || !lookUp || work.trim().length < 3} onPress={() => void setWorkplace()}>
            Set my commute
          </Button>
          {workplaces[me] && (
            <Button secondary disabled={busy} onPress={() => act({ action: 'workplace', workplace: null })}>
              Remove my commute
            </Button>
          )}
        </View>
      </View>
      {inviteForm}
      <Button secondary disabled={busy} onPress={() => act({ action: 'leave' })}>
        Leave the shared list
      </Button>
    </View>
  );
}
