/** One apartment's own page, opened from a shared link (#listing=ID): the listing with its details open. */
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
}: {
  id: string;
  load?: (id: string) => Promise<{ listing: ListingData }>;
  workplace: Workplace;
  saved: (listing: ListingData) => boolean;
  onSave: (listing: ListingData) => void;
  onSaveLink: (listing: ListingData, link: SourceLink) => void;
  onBack: () => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<{ listing: ListingData | null; error: string }>({ listing: null, error: '' });
  useEffect(() => {
    if (!load) return;
    setState({ listing: null, error: '' });
    load(id)
      .then(({ listing }) => setState({ listing, error: '' }))
      .catch((error) => setState({ listing: null, error: error instanceof Error ? error.message : 'This apartment could not be loaded.' }));
  }, [id, load]);
  return (
    <View style={{ gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
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
