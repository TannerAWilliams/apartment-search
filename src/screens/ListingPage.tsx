/** One apartment's own page (/listing/ID), opened from the results or a shared link: the listing with its details open. */
import type React from 'react';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ListingData, SourceLink, Workplace } from '../domain.ts';
import { Listing } from '../components/Listing.tsx';
import { styles } from '../styles.ts';

export function ListingPage({
  id,
  load,
  workplace,
  saved,
  onSave,
  onSaveLink,
  onBack,
  onError,
  initial,
  onCheckBuilding,
  loadStored,
}: {
  id: string;
  /** The apartment as the results showed it, so its page opens at once instead of loading it again. */
  initial?: ListingData;
  onCheckBuilding?: React.ComponentProps<typeof Listing>['onCheckBuilding'];
  load?: (id: string) => Promise<{ listing: ListingData }>;
  /**
   * The listing as its source saved it, read by one quick lookup: shown until the full one arrives (a shared
   * link opens on it), and the source of the recorded rents the inventory file leaves out.
   */
  loadStored?: (id: string) => Promise<{ listing: ListingData | null }>;
  workplace: Workplace;
  saved: (listing: ListingData) => boolean;
  onSave: (listing: ListingData) => void;
  onSaveLink: (listing: ListingData, link: SourceLink) => void;
  onBack: () => void;
  onError: (message: string) => void;
}) {
  const given = initial?.id === id ? initial : null;
  const [state, setState] = useState<{ listing: ListingData | null; error: string }>({ listing: given, error: '' });
  useEffect(() => {
    if (given) {
      setState({ listing: given, error: '' });
      return;
    }
    if (!load) return;
    let current = true;
    setState({ listing: null, error: '' });
    load(id)
      // The full listing replaces the quick one, keeping the recorded rents it may have brought.
      .then(({ listing }) => {
        if (current)
          setState((now) => ({ listing: { ...listing, priceHistory: listing.priceHistory ?? now.listing?.priceHistory }, error: '' }));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'This apartment could not be loaded.';
        // A quick copy already showing stays; otherwise the page says what went wrong.
        if (current) setState((now) => (now.listing ? now : { listing: null, error: message }));
      });
    return () => {
      current = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: the given listing is read when the page opens
  }, [id, load]);
  useEffect(() => {
    if (!loadStored) return;
    let current = true;
    loadStored(id)
      .then(({ listing: stored }) => {
        if (!current || !stored) return;
        setState((now) => {
          if (!now.listing) return { listing: stored, error: '' };
          return now.listing.priceHistory === undefined && stored.priceHistory
            ? { ...now, listing: { ...now.listing, priceHistory: stored.priceHistory } }
            : now;
        });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [id, loadStored]);
  return (
    <View style={{ gap: 12, maxWidth: 1080, width: '100%', alignSelf: 'center' }}>
      <Pressable accessibilityRole="button" onPress={onBack} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
        <Text style={styles.linkText}>← All apartments</Text>
      </Pressable>
      {state.listing ? (
        <Listing
          listing={state.listing}
          workplace={workplace}
          onSave={onSave}
          onSaveLink={onSaveLink}
          onError={onError}
          saved={saved(state.listing)}
          onCheckBuilding={onCheckBuilding}
          defaultExpanded
        />
      ) : (
        <Text accessibilityRole={state.error ? 'alert' : undefined} style={styles.bodyText}>
          {state.error || (load ? 'Loading the apartment…' : 'Connect to see this apartment.')}
        </Text>
      )}
    </View>
  );
}
