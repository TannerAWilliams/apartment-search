/**
 * The Market page's answers: a grid of small cards, each one question answered with one figure ("Best month to
 * sign: January"). Tapping a card opens its chart, with the controls and table, under the grid; only one is open,
 * so every figure is one tap away without a page of stacked charts.
 */
import type { ReactNode } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { colors, styles } from '../styles.ts';
import { toggleProps } from './ui.tsx';

export type Insight = {
  key: string;
  /** The question, short: "Typical rent", "Best month to sign". */
  question: string;
  /** The answer, one figure or word. */
  answer: string;
  /** One line that makes the answer make sense: what it is of, or what it is compared with. */
  context: string;
};

export function InsightCards({
  insights,
  selected,
  onSelect,
  note,
  children,
}: {
  insights: Insight[];
  selected: string;
  onSelect: (key: string) => void;
  /** A line under the cards, such as which areas the longer history covers. */
  note?: string;
  /** The open card's chart. */
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const columns = width >= 1000 ? 4 : width >= 640 ? 3 : 2;
  const open = insights.find(({ key }) => key === selected);
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {insights.map(({ key, question, answer, context }) => {
          const chosen = key === selected;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${question}: ${answer}. ${context}`}
              {...toggleProps(chosen)}
              onPress={() => onSelect(key)}
              style={({ pressed }) => [
                {
                  flexBasis: `${100 / columns - 2}%`,
                  flexGrow: 1,
                  minWidth: 0,
                  borderRadius: 12,
                  borderWidth: chosen ? 2 : 1,
                  borderColor: chosen ? colors.ink : colors.border,
                  padding: chosen ? 11 : 12,
                  gap: 2,
                  backgroundColor: colors.white,
                },
                pressed && styles.pressed,
              ]}
            >
              <Text numberOfLines={2} style={{ fontSize: 13, color: colors.muted }}>
                {question}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 22, lineHeight: 28, fontWeight: '700', color: colors.ink }}>
                {answer}
              </Text>
              <Text numberOfLines={2} style={{ fontSize: 13, lineHeight: 17, color: colors.muted }}>
                {context}
              </Text>
            </Pressable>
          );
        })}
        {/* Empty cells fill the last row, so a lone last card keeps the width of the others. */}
        {Array.from({ length: (columns - (insights.length % columns)) % columns }, (_, index) => (
          <View key={`filler-${index}`} style={{ flexBasis: `${100 / columns - 2}%`, flexGrow: 1, minWidth: 0 }} />
        ))}
      </View>
      {note ? <Text style={styles.smallMuted}>{note}</Text> : null}
      {open && (
        <View style={{ gap: 12 }} aria-live="polite">
          <Text accessibilityRole="header" style={styles.sectionHeading}>
            {open.question}
          </Text>
          {children}
        </View>
      )}
    </View>
  );
}
