/**
 * The profile's commute destination: where the person works or studies. Commute times on every listing are to it,
 * and it is kept on their account (or this device), so they set it once.
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { CommutePlace } from '../hooks/use-commute-place.ts';
import { WORKPLACES } from '../regions.ts';
import { styles } from '../styles.ts';
import { DestinationField } from './Filters.tsx';
import { Button, Chip } from './ui.tsx';

type Suggest = Parameters<typeof DestinationField>[0]['suggest'];

export function CommuteCard({
  place,
  onSave,
  suggest,
  signedIn,
}: {
  place: CommutePlace;
  onSave: (place: CommutePlace) => void;
  suggest?: Suggest;
  signedIn: boolean;
}) {
  const [draft, setDraft] = useState(place);
  const [saved, setSaved] = useState(false);
  // A new saved destination replaces the draft; the same one arriving again (each redraw) leaves typing alone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: compared by value, not by object
  useEffect(() => setDraft(place), [place.workplace, place.customWorkplace]);
  const label = place.workplace === 'custom' ? place.customWorkplace : (WORKPLACES[place.workplace]?.label ?? '');
  const changed = draft.workplace !== place.workplace || draft.customWorkplace !== place.customWorkplace;
  const ready = draft.workplace !== 'custom' || draft.customWorkplace.trim().length >= 4;
  return (
    <View style={[styles.menu, { padding: 16, gap: 10 }]}>
      <Text style={styles.smallMuted}>
        Commute times on every apartment are to {label || 'here'}.{' '}
        {signedIn ? 'Kept on your account, on every device.' : 'Kept on this device; sign in to keep it everywhere.'}
      </Text>
      <View style={styles.chipRow}>
        {Object.entries(WORKPLACES).map(([key, workplace]) => (
          <Chip key={key} selected={draft.workplace === key} onPress={() => setDraft({ workplace: key, customWorkplace: '' })}>
            {workplace.label}
          </Chip>
        ))}
        <Chip selected={draft.workplace === 'custom'} onPress={() => setDraft({ ...draft, workplace: 'custom' })}>
          Somewhere else
        </Chip>
      </View>
      {draft.workplace === 'custom' && (
        <DestinationField
          value={draft.customWorkplace}
          onChange={(customWorkplace) => setDraft({ ...draft, customWorkplace })}
          suggest={suggest}
        />
      )}
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
