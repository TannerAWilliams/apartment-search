import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatSnapshotMonth } from './market.ts';
import { type RentArea, type RentHistory, type RentPoint, rentSeries } from './rent-history.ts';
import { bedroomLabel, formatRent } from './search.ts';
import { styles } from './styles.ts';
import { toggleProps } from './ui.tsx';

const SERIES_COLORS = ['#206248', '#34638c', '#94512d'];
const CHART_HEIGHT = 178;
const AXIS_WIDTH = 65;
const PADDING = 10;
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const monthLabel = (month: string) => MONTH.format(new Date(month + '-01T00:00:00Z'));

function priceScale(values: number[]) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = Math.max(high - low, high * 0.18, 100);
  const rough = range / 4;
  const unit = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].find((multiple) => multiple * unit >= rough)! * unit;
  const min = Math.max(0, Math.floor((low - range * 0.05) / step) * step);
  const max = Math.max(min + step * 3, Math.ceil((high + range * 0.05) / step) * step);
  return { min, max, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => min + index * step) };
}

function Segment({ start, end, color }: { start: { x: number; y: number }; end: { x: number; y: number }; color: string }) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  return (
    <View
      style={[
        styles.trendLine,
        {
          width: length,
          left: (start.x + end.x - length) / 2,
          top: (start.y + end.y) / 2 - 1,
          backgroundColor: color,
          transform: [{ rotate: angle + 'rad' }],
        },
      ]}
    />
  );
}

function TrendPlot({
  series,
  points,
  scale,
  selectedIndex,
  onMonth,
}: {
  series: { id: string; color: string; values: RentPoint[] }[];
  points: RentPoint[];
  scale: ReturnType<typeof priceScale>;
  selectedIndex: number;
  onMonth: (month: string) => void;
}) {
  const [width, setWidth] = useState(0);
  const x = (index: number) => AXIS_WIDTH + ((width - AXIS_WIDTH) * (index + 0.5)) / points.length;
  const y = (price: number) => PADDING + ((CHART_HEIGHT - PADDING * 2) * (scale.max - price)) / (scale.max - scale.min);
  return (
    <>
      <View
        style={[styles.trendPlot, { height: CHART_HEIGHT }]}
        onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
        aria-hidden
        accessibilityElementsHidden
      >
        {scale.ticks.map((tick) => (
          <React.Fragment key={tick}>
            <View style={[styles.trendGrid, { top: y(tick), left: AXIS_WIDTH }]} />
            <Text style={[styles.trendTick, { top: y(tick) - 8, width: AXIS_WIDTH - 8 }]}>{formatRent(tick)}</Text>
          </React.Fragment>
        ))}
        {width > AXIS_WIDTH && (
          <>
            <View style={[styles.trendGuide, { left: x(selectedIndex), top: PADDING, bottom: PADDING }]} />
            {series.map(({ id, color, values }) => {
              const dots = values.map(({ median }, index) => (median === null ? null : { x: x(index), y: y(median) }));
              return (
                <React.Fragment key={id}>
                  {dots.map((dot, index) =>
                    dot && dots[index - 1] ? <Segment key={'line-' + index} start={dots[index - 1]!} end={dot} color={color} /> : null,
                  )}
                  {dots.map(
                    (dot, index) =>
                      dot && (
                        <View
                          key={'dot-' + index}
                          style={[
                            styles.trendDot,
                            index === selectedIndex && styles.trendDotActive,
                            {
                              left: dot.x - (index === selectedIndex ? 5 : 3),
                              top: dot.y - (index === selectedIndex ? 5 : 3),
                              backgroundColor: color,
                            },
                          ]}
                        />
                      ),
                  )}
                </React.Fragment>
              );
            })}
          </>
        )}
      </View>
      <View style={[styles.trendMonths, { marginLeft: AXIS_WIDTH }]}>
        {points.map(({ month }, index) => (
          <Pressable
            key={month}
            accessibilityRole="button"
            accessibilityLabel={formatSnapshotMonth(month)}
            {...toggleProps(index === selectedIndex)}
            onPress={() => onMonth(month)}
            style={[styles.trendMonth, index === selectedIndex && styles.trendMonthActive]}
          >
            <Text style={[styles.trendMonthText, index === selectedIndex && styles.trendMonthTextActive]}>{monthLabel(month)}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

export function RentTrend({
  areas,
  bedrooms,
  month,
  history,
}: {
  areas: RentArea[];
  bedrooms: number;
  month: string;
  history: RentHistory;
}) {
  const [selectedMonth, setSelectedMonth] = useState('');
  const series = useMemo(
    () =>
      areas.map((area, index) => ({
        id: area.id,
        label: area.label,
        detail: area.detail,
        color: SERIES_COLORS[index],
        values: rentSeries(area, bedrooms, month, history),
      })),
    [areas, bedrooms, month, history],
  );
  const primary = series[0];
  const index = primary.values.findIndex((point) => point.month === selectedMonth);
  const selectedIndex = index >= 0 ? index : primary.values.length - 1;
  const selected = primary.values[selectedIndex];
  const previous = primary.values[selectedIndex - 1];
  const change =
    selected.median !== null && typeof previous?.median === 'number' && previous.median > 0
      ? ((selected.median - previous.median) / previous.median) * 100
      : null;
  const prices = series.flatMap(({ values }) => values.map(({ median }) => median).filter((value) => value !== null));
  return (
    <>
      <View style={styles.trendHeadline}>
        <View style={styles.headingCopy}>
          <Text style={styles.chartKicker}>
            {bedroomLabel(bedrooms).toUpperCase()} · {formatSnapshotMonth(selected.month).toUpperCase()}
          </Text>
          <Text accessibilityRole="header" style={styles.trendPrice}>
            {selected.median === null ? 'No observations' : formatRent(selected.median)}
          </Text>
          <Text style={styles.smallMuted}>
            {primary.label}
            {primary.detail ? ' · ' + primary.detail : ''}
          </Text>
        </View>
        {change !== null && (
          <Text style={[styles.trendChange, change > 0 && styles.trendChangeUp]}>
            {(change > 0 ? '+' : '') + change.toFixed(1) + '% vs. ' + monthLabel(previous.month)}
          </Text>
        )}
      </View>
      {prices.length > 0 && (
        <TrendPlot
          series={series}
          points={primary.values}
          scale={priceScale(prices)}
          selectedIndex={selectedIndex}
          onMonth={setSelectedMonth}
        />
      )}
      <View style={styles.trendLegend}>
        {series.map(({ id, label, detail, color, values }) => {
          const point = values[selectedIndex];
          return (
            <View key={id} style={styles.trendLegendRow}>
              <View style={[styles.trendSwatch, { backgroundColor: color }]} />
              <Text style={styles.trendLegendLabel}>
                {label}
                {detail ? ' · ' + detail : ''}
              </Text>
              <Text style={styles.chartPrice}>{point.median === null ? '—' : formatRent(point.median)}</Text>
              <Text style={styles.chartCount}>n = {point.count.toLocaleString('en-US')}</Text>
            </View>
          );
        })}
      </View>
    </>
  );
}
