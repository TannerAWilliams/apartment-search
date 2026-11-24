/**
 * Categories under the search bar, as listing apps browse by kind: one tap searches for new listings, deals,
 * rent-stabilized buildings, homes near the subway, well-kept buildings, pets or in-unit laundry. The chosen one is
 * dark and underlined; tapping it again, or All, goes back to every apartment.
 */
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { SearchFilters } from '../domain.ts';
import { colors } from '../styles.ts';

type Icon = (color: string) => React.ReactNode;
const stroke = (color: string) =>
  ({ stroke: color, strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }) as const;

const ICONS: Record<string, Icon> = {
  all: (c) => (
    <>
      <Rect x={4} y={4} width={7} height={7} rx={1.5} {...stroke(c)} />
      <Rect x={13} y={4} width={7} height={7} rx={1.5} {...stroke(c)} />
      <Rect x={4} y={13} width={7} height={7} rx={1.5} {...stroke(c)} />
      <Rect x={13} y={13} width={7} height={7} rx={1.5} {...stroke(c)} />
    </>
  ),
  new: (c) => <Path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" {...stroke(c)} />,
  deals: (c) => (
    <>
      <Path d="M3.5 12.5l8-8H20v8.5l-8 8z" {...stroke(c)} />
      <Circle cx={16} cy={8} r={1.4} fill={c} />
    </>
  ),
  stabilized: (c) => <Path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4" {...stroke(c)} />,
  subway: (c) => (
    <>
      <Rect x={6} y={3} width={12} height={14} rx={3} {...stroke(c)} />
      <Path d="M6 10h12 M9 21l1.5-4 M15 21l-1.5-4" {...stroke(c)} />
      <Circle cx={9.5} cy={13.5} r={0.9} fill={c} />
      <Circle cx={14.5} cy={13.5} r={0.9} fill={c} />
    </>
  ),
  buildings: (c) => <Path d="M5 21V5l7-2v18 M12 8l7 2v11 M3 21h18 M8 8h1 M8 12h1 M8 16h1 M15 13h1 M15 17h1" {...stroke(c)} />,
  pets: (c) => (
    <>
      <Circle cx={7} cy={10} r={1.8} {...stroke(c)} />
      <Circle cx={10.5} cy={6} r={1.8} {...stroke(c)} />
      <Circle cx={14.5} cy={6} r={1.8} {...stroke(c)} />
      <Circle cx={18} cy={10} r={1.8} {...stroke(c)} />
      <Path d="M8.5 17.5c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5-2 2.5-4 2.5-4 0-4-2.5z" {...stroke(c)} />
    </>
  ),
  laundry: (c) => (
    <>
      <Rect x={4} y={3} width={16} height={18} rx={2} {...stroke(c)} />
      <Circle cx={12} cy={13} r={4.5} {...stroke(c)} />
      <Path d="M7 6.5h2" {...stroke(c)} />
    </>
  ),
};

/** Each category: its key, label, the filters it sets, and whether the current filters are that category. */
export const CATEGORIES: [key: string, label: string, set: Partial<SearchFilters>, active: (filters: SearchFilters) => boolean][] = [
  ['new', 'New', { newWithinDays: 3 }, (f) => f.newWithinDays === 3],
  ['deals', 'Deals', { belowMarket: true }, (f) => f.belowMarket === true],
  ['stabilized', 'Rent-stabilized', { stabilizedOnly: true }, (f) => f.stabilizedOnly === true],
  ['subway', 'Near subway', { nearSubway: true }, (f) => f.nearSubway === true],
  ['buildings', 'Good buildings', { goodBuildings: true }, (f) => f.goodBuildings === true],
  ['pets', 'Pets', { petsRequired: true }, (f) => f.petsRequired === true],
  ['laundry', 'In-unit laundry', { laundry: 'in_unit' }, (f) => f.laundry === 'in_unit'],
];
/** What clears every category. */
export const NO_CATEGORY: Partial<SearchFilters> = {
  newWithinDays: undefined,
  belowMarket: false,
  stabilizedOnly: false,
  nearSubway: false,
  goodBuildings: false,
  petsRequired: false,
  laundry: '',
};

export function CategoryBar({ applied, onChoose }: { applied: SearchFilters; onChoose: (changes: Partial<SearchFilters>) => void }) {
  const chosen = CATEGORIES.filter(([, , , active]) => active(applied)).map(([key]) => key);
  const items: [string, string, Partial<SearchFilters>][] = [
    ['all', 'All', NO_CATEGORY],
    ...CATEGORIES.map(([key, label, set]) => [key, label, set] as [string, string, Partial<SearchFilters>]),
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 26, paddingHorizontal: 4 }}>
      {items.map(([key, label, set]) => {
        const selected = key === 'all' ? chosen.length === 0 : chosen.includes(key);
        const color = selected ? colors.ink : colors.muted;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            aria-pressed={selected}
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            // Tapping the chosen category again clears it.
            onPress={() => onChoose(key === 'all' || selected ? NO_CATEGORY : { ...NO_CATEGORY, ...set })}
            style={({ pressed }) => [
              {
                alignItems: 'center',
                gap: 6,
                paddingTop: 4,
                paddingBottom: 10,
                borderBottomWidth: 2,
                borderBottomColor: selected ? colors.ink : 'transparent',
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
              {ICONS[key]!(color)}
            </Svg>
            <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: selected ? '600' : '500', color }}>{label}</Text>
          </Pressable>
        );
      })}
      <View style={{ width: 4 }} />
    </ScrollView>
  );
}
