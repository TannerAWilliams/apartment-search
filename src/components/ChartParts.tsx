/** What every chart on the market history page shares: its card, legend, tooltip, table view and width. */
import { type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, Platform, Text, View } from 'react-native';
import { CHART_INK } from '../chart-colors.ts';
import { styles } from '../styles.ts';
import { Chip } from './ui.tsx';
import { palette } from '../palette.ts';

/** The width the chart has to draw in, measured once laid out. */
export function useWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (event) => setWidth(Math.round(event.nativeEvent.layout.width))];
}

/** Where a pointer is across an overlay: React Native gives locationX, the web its DOM event's offsetX. */
export function pointerX(event: { nativeEvent: object }) {
  const native = event.nativeEvent as { locationX?: number; offsetX?: number };
  return typeof native.locationX === 'number' ? native.locationX : (native.offsetX ?? 0);
}
export function pointerY(event: { nativeEvent: object }) {
  const native = event.nativeEvent as { locationY?: number; offsetY?: number };
  return typeof native.locationY === 'number' ? native.locationY : (native.offsetY ?? 0);
}

/** SVG text does not inherit the app's font, so charts name the system sans themselves. */
export const CHART_FONT = Platform.OS === 'web' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' : undefined;

export const tabular = Platform.OS === 'web' ? ({ fontVariant: ['tabular-nums'] } as const) : {};

export type LegendItem = { label: string; color: string; shape?: 'line' | 'square' | 'dot' };
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      {items.map(({ label, color, shape = 'line' }) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={
              shape === 'line'
                ? { width: 16, height: 3, borderRadius: 2, backgroundColor: color }
                : { width: 10, height: 10, borderRadius: shape === 'dot' ? 5 : 2, backgroundColor: color }
            }
          />
          <Text style={{ fontSize: 13, color: CHART_INK.secondary }}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

/** The tooltip: the value leads, the series name follows, each row keyed by a short line of its color. */
export function Tooltip({
  title,
  rows,
  left,
  top,
  alignRight,
}: {
  title: string;
  rows: { color?: string; label: string; value: string }[];
  left: number;
  top: number;
  alignRight: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        ...(alignRight ? { right: left } : { left }),
        backgroundColor: CHART_INK.surface,
        borderColor: palette.gray[1],
        borderWidth: 1,
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
        gap: 4,
        minWidth: 140,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <Text style={{ fontSize: 12, color: CHART_INK.secondary }}>{title}</Text>
      {rows.map((row) => (
        <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {row.color && <View style={{ width: 12, height: 3, borderRadius: 2, backgroundColor: row.color }} />}
          <Text style={[{ fontSize: 14, fontWeight: '700', color: CHART_INK.primary }, tabular]}>{row.value}</Text>
          <Text style={{ fontSize: 12, color: CHART_INK.secondary, flexShrink: 1 }}>{row.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** A table: the accessible twin of a chart, and the place every value can be read without hovering. */
export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <View accessibilityRole={Platform.OS === 'web' ? undefined : 'summary'} style={{ borderTopWidth: 1, borderColor: CHART_INK.grid }}>
      <View style={{ flexDirection: 'row', paddingVertical: 6 }}>
        {columns.map((column, index) => (
          <Text key={column} style={[cell(index), { fontWeight: '700', color: CHART_INK.primary }]}>
            {column}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row', paddingVertical: 4, borderTopWidth: 1, borderColor: CHART_INK.grid }}>
          {row.map((value, index) => (
            <Text key={index} style={[cell(index), tabular]}>
              {value}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
const cell = (index: number) => ({
  flex: index === 0 ? 1.4 : 1,
  fontSize: 13,
  color: CHART_INK.secondary,
  textAlign: index === 0 ? ('left' as const) : ('right' as const),
  paddingRight: 6,
});

/** A chart's card: title, a sentence on how to read it, the chart, and its table behind a toggle. */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  busy = false,
}: {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  table?: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  busy?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <View style={[styles.chartCard, { opacity: busy ? 0.55 : 1 }]}>
      <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '800', color: CHART_INK.primary }}>
        {title}
      </Text>
      {subtitle ? <Text style={styles.smallMuted}>{subtitle}</Text> : null}
      {legend && legend.length > 1 && <Legend items={legend} />}
      {children}
      {table && (
        <>
          <View style={{ flexDirection: 'row' }}>
            <Chip selected={showTable} onPress={() => setShowTable(!showTable)}>
              {showTable ? 'Hide table' : 'Show table'}
            </Chip>
          </View>
          {showTable && <DataTable {...table} />}
        </>
      )}
    </View>
  );
}
