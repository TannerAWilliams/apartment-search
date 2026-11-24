/**
 * The home page's three quick questions (where, what size, what budget) and when you move, then the matching
 * apartments, with an offer to get alerts for them.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';
import type { SearchFilters } from '../domain.ts';
import { Button, Chip, Field } from '../components/ui.tsx';
import { colors, styles } from '../styles.ts';

const AREAS: [string, string][] = [
  ['nyc', 'Anywhere in NYC'],
  ['manhattan', 'Manhattan'],
  ['brooklyn', 'Brooklyn'],
  ['queens', 'Queens'],
  ['bronx', 'The Bronx'],
  ['staten-island', 'Staten Island'],
  ['nj', 'New Jersey'],
];
const SIZES: [number | null, string][] = [
  [null, 'Any size'],
  [0, 'Studio'],
  [1, '1 bedroom'],
  [2, '2 bedrooms'],
  [3, '3 bedrooms'],
];
const WHEN = ['As soon as possible', 'Within a month', 'In 1–3 months', 'Just looking'];

export function Welcome({ onDone }: { onDone: (filters: Partial<SearchFilters>, alerts: boolean) => void }) {
  const [region, setRegion] = useState('nyc');
  const [bedrooms, setBedrooms] = useState<number | null>(1);
  const [budget, setBudget] = useState('');
  const [when, setWhen] = useState(WHEN[1]!);
  const rent = /^\d{3,6}$/.test(budget.trim()) ? Number(budget.trim()) : null;
  const filters: Partial<SearchFilters> = { region, bedrooms, maxRent: rent };
  return (
    <View style={[styles.chartCard, { gap: 14 }]}>
      <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '600', color: colors.ink }}>
        Three quick questions
      </Text>
      <Text style={styles.fieldLabel}>Where do you want to live?</Text>
      <View style={styles.chipRow}>
        {AREAS.map(([key, label]) => (
          <Chip key={key} selected={region === key} onPress={() => setRegion(key)}>
            {label}
          </Chip>
        ))}
      </View>
      <Text style={styles.fieldLabel}>How big?</Text>
      <View style={styles.chipRow}>
        {SIZES.map(([count, label]) => (
          <Chip key={label} selected={bedrooms === count} onPress={() => setBedrooms(count)}>
            {label}
          </Chip>
        ))}
      </View>
      <Field
        label="Most you’d pay a month"
        value={budget}
        onChangeText={(text) => setBudget(text.replace(/[^\d]/g, ''))}
        keyboardType="number-pad"
        placeholder="Any budget"
        maxLength={6}
      />
      <Text style={styles.fieldLabel}>When are you moving?</Text>
      <View style={styles.chipRow}>
        {WHEN.map((label) => (
          <Chip key={label} selected={when === label} onPress={() => setWhen(label)}>
            {label}
          </Chip>
        ))}
      </View>
      <Button onPress={() => onDone(filters, false)}>Show my apartments</Button>
      {when !== 'Just looking' && (
        <Button secondary onPress={() => onDone(filters, true)}>
          Show them and get email alerts
        </Button>
      )}
    </View>
  );
}
