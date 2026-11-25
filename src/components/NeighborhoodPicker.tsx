/**
 * Choosing any number of neighborhoods without a wall of buttons: the chosen ones as chips to remove, a box to find
 * more by name, and a few of the busiest to add in one tap while nothing is typed.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { styles } from '../styles.ts';
import { Chip, Field } from './ui.tsx';

export type NeighborhoodChoice = { id: string; label: string; detail: string; count: number };
const POPULAR = 6;
const MATCHES = 8;

export function NeighborhoodPicker({
  choices,
  picked,
  onChange,
  showBorough,
}: {
  /** The neighborhoods to choose from, busiest first. */
  choices: NeighborhoodChoice[];
  picked: string[];
  onChange: (picked: string[]) => void;
  /** Whether to name each one's borough (when the choices span the city). */
  showBorough: boolean;
}) {
  const [typed, setTyped] = useState('');
  const query = typed.trim().toLowerCase();
  const open = choices.filter(({ label }) => !picked.includes(label));
  const shown = query
    ? open
        .filter(({ label }) => label.toLowerCase().includes(query))
        .sort((a, b) => Number(!a.label.toLowerCase().startsWith(query)) - Number(!b.label.toLowerCase().startsWith(query)))
        .slice(0, MATCHES)
    : open.slice(0, POPULAR);
  const where = (detail: string) => detail.replace(/, NY$/, '');
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.smallMuted}>
        {picked.length ? `Neighborhoods (${picked.length})` : 'Neighborhoods (optional: none means the whole area)'}
      </Text>
      {picked.length > 0 && (
        <View style={styles.chipRow}>
          {picked.map((name) => (
            <Chip key={name} selected label={`Remove ${name}`} onPress={() => onChange(picked.filter((item) => item !== name))}>
              {`${name} ✕`}
            </Chip>
          ))}
        </View>
      )}
      <Field label="Add a neighborhood" value={typed} onChangeText={setTyped} placeholder="Type a name, like Astoria" maxLength={60} />
      <Text style={styles.smallMuted}>
        {query ? (shown.length ? 'Tap to add' : `No neighborhood matches “${typed.trim()}”.`) : 'Popular'}
      </Text>
      <View style={styles.chipRow}>
        {shown.map(({ id, label, detail }) => (
          <Chip
            key={id}
            label={`Add ${label}${showBorough ? `, ${where(detail)}` : ''}`}
            onPress={() => {
              onChange([...picked, label]);
              setTyped('');
            }}
          >
            {`+ ${label}${showBorough ? ` · ${where(detail)}` : ''}`}
          </Chip>
        ))}
      </View>
    </View>
  );
}
