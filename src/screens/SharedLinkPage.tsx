/**
 * A shared list opened by its link (/s/TOKEN), for someone without an account: the apartments, how the people
 * sharing it voted, the notes, and a place to leave a note under a name (server/households.ts).
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Field } from '../components/ui.tsx';
import type { ListingData } from '../domain.ts';
import { bedroomLabel, formatRent } from '../search.ts';
import { styles } from '../styles.ts';

export type SharedByLink = {
  members: string[];
  listings: ListingData[];
  votes: Record<string, Record<string, 'yes' | 'no'>>;
  notes: Record<string, { by: string; text: string; at: string }[]>;
};
type Reply = { list: SharedByLink };

const title = (listing: ListingData) => (listing.unit ? `${listing.address}, Unit ${listing.unit}` : listing.address);

export function SharedLinkPage({
  load,
  addNote,
  onOpenListing,
  onSearch,
}: {
  load?: () => Promise<Reply>;
  addNote: (note: { id: string; name: string; text: string }) => Promise<Reply>;
  /** Opens an apartment's own page. */
  onOpenListing: (listing: ListingData) => void;
  onSearch: () => void;
}) {
  const [list, setList] = useState<SharedByLink | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!load) return;
    let current = true;
    load()
      .then((reply) => current && setList(reply.list))
      .catch((cause) => current && setError(cause instanceof Error ? cause.message : 'This list could not be opened.'));
    return () => {
      current = false;
    };
  }, [load]);

  async function send(id: string) {
    setBusy(true);
    setError('');
    try {
      setList((await addNote({ id, name: name.trim(), text: (drafts[id] ?? '').trim() })).list);
      setDrafts((current) => ({ ...current, [id]: '' }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The note could not be added.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.marketplacePanel}>
      <View style={styles.chartIntro}>
        <Text accessibilityRole="header" style={styles.chartTitle}>
          {list ? `Apartments ${list.members.join(' and ')} ${list.members.length > 1 ? 'are' : 'is'} considering` : 'Shared list'}
        </Text>
        <Text style={styles.bodyText}>
          You were sent this list to look over. Leave a note on any apartment; no account is needed, and only people with the link see it.
        </Text>
      </View>
      {error !== '' && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!list && error === '' && <Text style={styles.smallMuted}>{load ? 'Loading…' : 'Connect to open this list.'}</Text>}
      {list && (
        <>
          <View style={styles.chartCard}>
            <Field label="Your name" value={name} onChangeText={setName} maxLength={40} placeholder="So they know whose notes these are" />
          </View>
          {list.listings.length === 0 && <Text style={styles.bodyText}>No apartments have been added to this list yet.</Text>}
          {list.listings.map((listing) => {
            const votes = Object.entries(list.votes[listing.id] ?? {});
            const notes = list.notes[listing.id] ?? [];
            const draft = drafts[listing.id] ?? '';
            return (
              <View key={listing.id} style={[styles.chartCard, { gap: 6 }]}>
                <Pressable accessibilityRole="link" accessibilityLabel={`Open ${title(listing)}`} onPress={() => onOpenListing(listing)}>
                  <Text style={styles.linkText}>{title(listing)}</Text>
                </Pressable>
                <Text style={styles.bodyText}>
                  {[listing.neighborhood || listing.city, bedroomLabel(listing.bedrooms), formatRent(listing.rent) + ' a month']
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {votes.length > 0 && (
                  <Text style={styles.smallMuted}>
                    {votes.map(([who, vote]) => `${who}: ${vote === 'yes' ? 'yes' : 'no'}`).join(' · ')}
                  </Text>
                )}
                {notes.map((note) => (
                  <Text key={note.at + note.by} style={styles.bodyText}>
                    {note.by}: {note.text}
                  </Text>
                ))}
                <Field
                  label={`Note on ${title(listing)}`}
                  value={draft}
                  onChangeText={(text) => setDrafts((current) => ({ ...current, [listing.id]: text }))}
                  maxLength={500}
                  placeholder="What do you think?"
                />
                <View style={styles.chipRow}>
                  <Button secondary disabled={busy || !name.trim() || !draft.trim()} onPress={() => void send(listing.id)}>
                    Add note
                  </Button>
                  {!name.trim() && draft.trim() !== '' && <Text style={styles.smallMuted}>Add your name above first.</Text>}
                </View>
              </View>
            );
          })}
        </>
      )}
      {/* Walkup's own invitation, for the person the list was sent to. */}
      <View style={[styles.chartCard, { gap: 8 }]}>
        <Text style={styles.bodyText}>
          Walkup searches New York apartments from every listing site at once, with each building’s records.
        </Text>
        <View style={styles.chipRow}>
          <Button onPress={onSearch}>Search apartments</Button>
        </View>
      </View>
    </View>
  );
}
