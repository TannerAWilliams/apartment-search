/**
 * The home page's search, as listing sites put theirs: where (an area or a neighborhood, suggested as it is
 * typed), how many bedrooms (several at once), the most rent, and Search. Under it, a few neighborhoods to start
 * from in one tap.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { SearchFilters } from '../domain.ts';
import { NYC_BOROUGHS, REGIONS } from '../regions.ts';
import { colors, styles } from '../styles.ts';
import { SearchIcon } from './Icons.tsx';

type Place = { label: string; detail: string; region: string; neighborhood?: string };
export type NeighborhoodLoader = (signal: AbortSignal) => Promise<{ areas?: { id: string; label: string; detail: string }[] }>;

/** The areas the search covers, by name. */
const AREAS: Place[] = (
  ['nyc', 'manhattan', 'brooklyn', 'queens', 'bronx', 'staten-island', 'nj', 'westchester', 'li', 'ct'] as (keyof typeof REGIONS)[]
).map((region) => ({ label: REGIONS[region].label, detail: region === 'nyc' ? 'All five boroughs' : 'Area', region }));
/** Neighborhoods people often start from, offered when the Where box is opened and still empty. */
const POPULAR: Place[] = (
  [
    ['Williamsburg', 'brooklyn'],
    ['Astoria', 'queens'],
    ['Upper West Side', 'manhattan'],
    ['Park Slope', 'brooklyn'],
    ['Harlem', 'manhattan'],
    ['Long Island City', 'queens'],
    ['Bushwick', 'brooklyn'],
    ['East Village', 'manhattan'],
  ] as [string, (typeof NYC_BOROUGHS)[number]][]
).map(([name, borough]) => ({ label: name, detail: REGIONS[borough].label, region: borough, neighborhood: name }));
const boroughKey = (detail: string) => NYC_BOROUGHS.find((key) => detail.toLowerCase().replace(/ /g, '-').startsWith(key)) ?? 'nyc';
const SIZES: [number, string][] = [
  [0, 'Studio'],
  [1, '1'],
  [2, '2'],
  [3, '3'],
  [4, '4+'],
];

export function HomeSearch({
  onSearch,
  loadNeighborhoods,
}: {
  onSearch: (changes: Partial<SearchFilters>) => void;
  loadNeighborhoods?: NeighborhoodLoader;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const [text, setText] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [focused, setFocused] = useState(false);
  const [beds, setBeds] = useState<number[]>([]);
  const [rent, setRent] = useState('');
  const neighborhoods = useRef<Place[] | null>(null);
  const [, setLoaded] = useState(0);
  // Neighborhood names arrive once, the first time someone types where.
  useEffect(() => {
    if (!focused || neighborhoods.current || !loadNeighborhoods) return;
    const controller = new AbortController();
    loadNeighborhoods(controller.signal)
      .then(({ areas = [] }) => {
        neighborhoods.current = areas
          .filter(({ id }) => id.includes('|'))
          .map(({ label, detail }) => ({ label, detail: detail.replace(/, NY$/, ''), region: boroughKey(detail), neighborhood: label }));
        setLoaded((count) => count + 1);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [focused, loadNeighborhoods]);
  const query = text.trim().toLowerCase();
  // Typing narrows the areas and neighborhoods; an empty box offers the ones people most often start from.
  const suggestions = !focused
    ? []
    : !query
      ? POPULAR
      : place?.label !== text
        ? [...AREAS, ...(neighborhoods.current ?? [])]
            .filter(({ label }) => label.toLowerCase().includes(query))
            .sort((a, b) => Number(!a.label.toLowerCase().startsWith(query)) - Number(!b.label.toLowerCase().startsWith(query)))
            .slice(0, 7)
        : [];
  const maxRent = Number(rent.replace(/\D/g, '')) || null;
  const search = (chosen = place) =>
    onSearch({
      region: chosen?.region ?? 'nyc',
      neighborhood: chosen?.neighborhood ?? '',
      bedrooms: beds.length === 1 ? beds[0]! : null,
      bedroomOptions: beds,
      maxRent,
    });
  const pick = (chosen: Place) => {
    setPlace(chosen);
    setText(chosen.label);
    setFocused(false);
  };

  const box = { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white } as const;
  return (
    <View style={{ gap: 14, zIndex: 5 }}>
      <View
        accessibilityRole="search"
        style={[
          box,
          { padding: 8, gap: 8, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
          wide && { flexDirection: 'row', alignItems: 'center', borderRadius: 999, paddingLeft: 20 },
        ]}
      >
        <View style={[{ gap: 2, paddingHorizontal: wide ? 0 : 8, paddingTop: wide ? 0 : 4 }, wide && { flex: 1.4 }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>Where</Text>
          <TextInput
            accessibilityLabel="Where"
            value={text}
            onChangeText={(value) => {
              setText(value);
              if (place && value !== place.label) setPlace(null);
            }}
            onFocus={() => setFocused(true)}
            onSubmitEditing={() => search(suggestions[0] ?? place)}
            placeholder="Neighborhood, borough or area"
            placeholderTextColor={colors.muted}
            style={{ fontSize: 16, color: colors.ink, paddingVertical: 4, outlineStyle: 'none' } as object}
          />
        </View>
        {wide && <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginVertical: 6 }} />}
        <View style={[{ gap: 4, paddingHorizontal: 8 }, wide && { flex: 1.2 }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>Bedrooms</Text>
          <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
            {SIZES.map(([count, label]) => {
              const on = beds.includes(count);
              return (
                <Pressable
                  key={count}
                  accessibilityRole="button"
                  accessibilityLabel={count === 0 ? 'Studio' : `${label} bedroom${count === 1 ? '' : 's'}`}
                  aria-pressed={on}
                  onPress={() => setBeds(on ? beds.filter((item) => item !== count) : [...beds, count].sort())}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: on ? colors.ink : colors.border,
                    backgroundColor: on ? colors.ink : colors.white,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: on ? colors.white : colors.ink }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {wide && <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: colors.border, marginVertical: 6 }} />}
        <View style={[{ gap: 2, paddingHorizontal: 8 }, wide && { flex: 0.8 }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>Max rent</Text>
          <TextInput
            accessibilityLabel="Max rent"
            value={rent}
            onChangeText={(value) => {
              const digits = String(Math.min(Number(value.replace(/\D/g, '').slice(0, 9)) || 0, 100000) || '');
              setRent(digits ? '$' + Number(digits).toLocaleString('en-US') : '');
            }}
            keyboardType="number-pad"
            placeholder="Any"
            placeholderTextColor={colors.muted}
            style={{ fontSize: 16, color: colors.ink, paddingVertical: 4, outlineStyle: 'none' } as object}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search apartments"
          onPress={() => search()}
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              backgroundColor: colors.green,
              borderRadius: 999,
              paddingHorizontal: 20,
              minHeight: 48,
            },
            pressed && styles.pressed,
          ]}
        >
          <SearchIcon color={colors.white} size={18} />
          <Text style={{ color: colors.white, fontWeight: '700', fontSize: 15 }}>Search</Text>
        </Pressable>
      </View>
      {suggestions.length > 0 && (
        <View
          accessibilityRole="list"
          style={[
            box,
            { position: 'absolute', top: wide ? 76 : 76, left: 0, right: wide ? '40%' : 0, zIndex: 20, paddingVertical: 6 },
            { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
          ]}
        >
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.label + suggestion.detail}
              accessibilityRole="button"
              accessibilityLabel={`${suggestion.label}, ${suggestion.detail}`}
              onPress={() => pick(suggestion)}
              style={({ pressed }) => [{ paddingHorizontal: 16, paddingVertical: 10 }, pressed && styles.pressed]}
            >
              <Text style={{ fontSize: 15, color: colors.ink, fontWeight: '600' }}>{suggestion.label}</Text>
              <Text style={styles.smallMuted}>{suggestion.detail}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
