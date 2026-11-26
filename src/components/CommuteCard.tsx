/**
 * The profile's commute destination: where the person works or studies. Commute times on every listing are to it,
 * and it is kept on their account, so they set it once. One search box: a place or an address, then Save.
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { type CommutePlace, samePlace } from '../hooks/use-commute-place.ts';
import { styles } from '../styles.ts';
import { CommuteField } from './Filters.tsx';
import { Button } from './ui.tsx';

type Suggest = Parameters<typeof CommuteField>[0]['suggest'];

export function CommuteCard({
  place,
  onSave,
  suggest,
  onAccount,
}: {
  place: CommutePlace;
  onSave: (place: CommutePlace) => void;
  suggest?: Suggest;
  /** Whether it is kept on an account (an admin signed in by token has none, and it stays on the device). */
  onAccount: boolean;
}) {
  const [draft, setDraft] = useState(place);
  const [saved, setSaved] = useState(false);
  // A new saved destination replaces the draft; the same one arriving again (each redraw) leaves typing alone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: compared by value, not by object
  useEffect(() => setDraft(place), [place.workplace, place.customWorkplace]);
  const changed = !samePlace(draft, place);
  const ready = draft.workplace !== 'custom' || draft.customWorkplace.trim().length >= 4;
  return (
    <View style={[styles.menu, { padding: 16, gap: 10 }]}>
      <Text style={styles.smallMuted}>
        Commute times on every apartment are to this place. {onAccount ? 'Kept on your account, on every device.' : 'Kept on this device.'}
      </Text>
      <CommuteField
        place={draft}
        suggest={suggest}
        onChange={(next) => {
          setDraft(next);
          setSaved(false);
        }}
      />
      {(changed || saved) && (
        <View style={styles.chipRow}>
          <Button
            disabled={!changed || !ready}
            onPress={() => {
              onSave({ workplace: draft.workplace, customWorkplace: draft.workplace === 'custom' ? draft.customWorkplace.trim() : '' });
              setSaved(true);
            }}
          >
            {changed ? 'Save commute' : 'Saved'}
          </Button>
        </View>
      )}
    </View>
  );
}
