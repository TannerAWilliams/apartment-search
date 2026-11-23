/**
 * A line chart over months: one or more series on one y-axis, broken where a month is unknown, with a
 * crosshair that reads every series at once (pointer, touch, or the arrow keys once focused).
 */
import { useState } from 'react';
import { Platform, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { CHART_INK } from '../chart-colors.ts';
import { monthLabel, nearestIndex, niceTicks } from '../market-history.ts';
import { CHART_FONT, pointerX, Tooltip, useWidth } from './ChartParts.tsx';

export type LineSeries = { key: string; label: string; color: string; values: (number | null)[] };

const HEIGHT = 260;
const TOP = 14;
const BOTTOM = 28;

export function LineChart({
  months,
  series,
  format,
  formatAxis,
  zeroBased = false,
  height = HEIGHT,
  endLabels = true,
}: {
  months: string[];
  series: LineSeries[];
  /** A value as the tooltip and end labels show it. */
  format: (value: number) => string;
  /** A value as the y-axis shows it (shorter). */
  formatAxis: (value: number) => string;
  zeroBased?: boolean;
  height?: number;
  endLabels?: boolean;
}) {
  const [width, onLayout] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const known = series.flatMap(({ values }) => values.filter((value): value is number => value !== null && Number.isFinite(value)));
  const labelled = endLabels && width >= 520;
  const left = 54;
  const right = labelled ? 118 : 14;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = height - TOP - BOTTOM;

  let low = known.length ? Math.min(...known) : 0;
  let high = known.length ? Math.max(...known) : 1;
  if (zeroBased) low = Math.min(0, low);
  const pad = (high - low || Math.abs(high) || 1) * 0.08;
  if (!zeroBased || low < 0) low -= pad;
  high += pad;
  const ticks = niceTicks(low, high, 5);
  const min = Math.min(low, ticks[0] ?? low);
  const max = Math.max(high, ticks.at(-1) ?? high);
  const x = (index: number) => left + (months.length > 1 ? (plotWidth * index) / (months.length - 1) : plotWidth / 2);
  const y = (value: number) => TOP + (plotHeight * (max - value)) / (max - min || 1);

  // Year ticks, spaced so labels never touch; quarters when the range is two years or less.
  const short = months.length <= 25;
  const marks = months
    .map((month, index) => ({ month, index }))
    .filter(({ month }) => (short ? ['01', '04', '07', '10'].includes(month.slice(5)) : month.endsWith('-01')));
  const every = Math.max(1, Math.ceil(marks.length / Math.max(1, Math.floor(plotWidth / (short ? 70 : 46)))));
  const xTicks = marks.filter((_, position) => position % every === 0);

  const path = (values: (number | null)[]) => {
    let d = '';
    let drawing = false;
    values.forEach((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        drawing = false;
        return;
      }
      d += `${drawing ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
      drawing = true;
    });
    return d;
  };
  /** A single series gets a faint wash down to the axis, one closed shape per unbroken stretch. */
  const area = (values: (number | null)[]) =>
    path(values).replace(/M([\d.]+),([\d.]+)((?:L[\d.]+,[\d.]+)*)/g, (_, x0: string, y0: string, rest: string) => {
      const lastX = rest ? rest.slice(rest.lastIndexOf('L') + 1).split(',')[0] : x0;
      return `M${x0},${TOP + plotHeight}L${x0},${y0}${rest}L${lastX},${TOP + plotHeight}Z`;
    });
  const lastKnown = (values: (number | null)[]) => {
    for (let index = values.length - 1; index >= 0; index--) if (values[index] !== null) return index;
    return -1;
  };

  // End labels: placed at each line's last value, pushed apart where lines end close together.
  const ends = series
    .map((item) => ({ item, index: lastKnown(item.values) }))
    .filter(({ index }) => index >= 0)
    .map(({ item, index }) => ({ item, index, y: y(item.values[index]!) }))
    .sort((a, b) => a.y - b.y);
  for (let position = 1; position < ends.length; position++) ends[position]!.y = Math.max(ends[position]!.y, ends[position - 1]!.y + 30);

  const move = (offset: number) => {
    const index = (hover ?? months.length - 1) + offset;
    setHover(Math.max(0, Math.min(months.length - 1, index)));
  };
  const keyboard =
    Platform.OS === 'web'
      ? {
          focusable: true,
          onKeyDown: (event: { nativeEvent: { key: string }; preventDefault(): void }) => {
            if (event.nativeEvent.key === 'ArrowLeft' || event.nativeEvent.key === 'ArrowRight') {
              event.preventDefault();
              move(event.nativeEvent.key === 'ArrowLeft' ? -1 : 1);
            }
          },
          onBlur: () => setHover(null),
        }
      : {};

  const hoverX = hover === null ? 0 : x(hover);
  return (
    <View onLayout={onLayout} style={{ height, width: '100%' }}>
      {width > 0 && known.length > 0 && (
        <Svg width={width} height={height}>
          {ticks.map((tick) => (
            <Line key={tick} x1={left} x2={left + plotWidth} y1={y(tick)} y2={y(tick)} stroke={CHART_INK.grid} strokeWidth={1} />
          ))}
          {ticks.map((tick) => (
            <SvgText
              fontFamily={CHART_FONT}
              key={'label' + tick}
              x={left - 8}
              y={y(tick) + 4}
              fontSize={11}
              fill={CHART_INK.muted}
              textAnchor="end"
            >
              {formatAxis(tick)}
            </SvgText>
          ))}
          <Line x1={left} x2={left + plotWidth} y1={TOP + plotHeight} y2={TOP + plotHeight} stroke={CHART_INK.axis} strokeWidth={1} />
          {xTicks.map(({ month, index }) => (
            <SvgText
              fontFamily={CHART_FONT}
              key={month}
              x={x(index)}
              y={height - 8}
              fontSize={11}
              fill={CHART_INK.muted}
              textAnchor="middle"
            >
              {short ? `${monthLabel(month).slice(0, 3)} ’${month.slice(2, 4)}` : month.slice(0, 4)}
            </SvgText>
          ))}
          {min < 0 && max > 0 && <Line x1={left} x2={left + plotWidth} y1={y(0)} y2={y(0)} stroke={CHART_INK.axis} strokeWidth={1} />}
          {series.length === 1 && series[0] && zeroBased && <Path d={area(series[0].values)} fill={series[0].color} fillOpacity={0.1} />}
          {series.map((item) => (
            <Path
              key={item.key}
              d={path(item.values)}
              fill="none"
              stroke={item.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {ends.map(({ item, index }) => (
            <Circle
              key={'end' + item.key}
              cx={x(index)}
              cy={y(item.values[index]!)}
              r={4}
              fill={item.color}
              stroke={CHART_INK.surface}
              strokeWidth={2}
            />
          ))}
          {labelled &&
            ends.map(({ item, index, y: labelY }) => (
              <SvgText
                fontFamily={CHART_FONT}
                key={'name' + item.key}
                x={x(index) + 10}
                y={labelY - 2}
                fontSize={12}
                fill={CHART_INK.secondary}
              >
                {item.label.length > 16 ? item.label.slice(0, 15) + '…' : item.label}
              </SvgText>
            ))}
          {labelled &&
            ends.map(({ item, index, y: labelY }) => (
              <SvgText
                fontFamily={CHART_FONT}
                key={'value' + item.key}
                x={x(index) + 10}
                y={labelY + 12}
                fontSize={12}
                fontWeight="700"
                fill={CHART_INK.primary}
              >
                {format(item.values[index]!)}
              </SvgText>
            ))}
          {hover !== null && <Line x1={hoverX} x2={hoverX} y1={TOP} y2={TOP + plotHeight} stroke={CHART_INK.muted} strokeWidth={1} />}
          {hover !== null &&
            series.map((item) =>
              typeof item.values[hover] === 'number' ? (
                <Circle
                  key={'hover' + item.key}
                  cx={hoverX}
                  cy={y(item.values[hover]!)}
                  r={4}
                  fill={item.color}
                  stroke={CHART_INK.surface}
                  strokeWidth={2}
                />
              ) : null,
            )}
        </Svg>
      )}
      {width > 0 && known.length > 0 && (
        <View
          accessibilityLabel="Chart. Use the left and right arrow keys to read each month; the table lists every value."
          {...keyboard}
          onPointerMove={(event) => setHover(nearestIndex((pointerX(event) - left) / plotWidth, months.length))}
          onPointerDown={(event) => setHover(nearestIndex((pointerX(event) - left) / plotWidth, months.length))}
          onPointerLeave={() => setHover(null)}
          style={{ position: 'absolute', left: 0, top: 0, width, height }}
        />
      )}
      {hover !== null && months[hover] && (
        <Tooltip
          title={monthLabel(months[hover])}
          rows={series.map((item) => ({
            color: item.color,
            label: item.label,
            value: item.values[hover] === null || item.values[hover] === undefined ? 'Not reported' : format(item.values[hover]!),
          }))}
          left={hoverX > width / 2 ? width - hoverX + 12 : hoverX + 12}
          top={TOP}
          alignRight={hoverX > width / 2}
        />
      )}
    </View>
  );
}
