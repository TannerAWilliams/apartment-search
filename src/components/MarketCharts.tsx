/**
 * The market history page's other charts: stat tiles with sparklines, ranked bars, the year-over-year
 * heatmap, seasonality columns and the market-temperature scatter. Each mark answers to hover, touch and
 * focus; the cards these sit in also give every value as a table.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { CHART_INK, divergingColor, SERIES_COLORS, textOn } from '../chart-colors.ts';
import { divergingPosition, niceTicks, type Ranked, type ScatterPoint } from '../market-history.ts';
import { CHART_FONT, pointerX, pointerY, tabular, Tooltip, useWidth } from './ChartParts.tsx';

/** A small line of the last values, the latest point marked. */
export function Sparkline({ values, width = 120, height = 32 }: { values: (number | null)[]; width?: number; height?: number }) {
  const known = values
    .map((value, index) => ({ value, index }))
    .filter((point): point is { value: number; index: number } => point.value !== null);
  if (known.length < 2) return <View style={{ width, height }} />;
  const low = Math.min(...known.map(({ value }) => value));
  const high = Math.max(...known.map(({ value }) => value));
  const x = (index: number) => 3 + ((width - 6) * index) / Math.max(1, values.length - 1);
  const y = (value: number) => 3 + (height - 6) * (high === low ? 0.5 : (high - value) / (high - low));
  const last = known.at(-1)!;
  return (
    <Svg width={width} height={height} aria-hidden>
      <Polyline
        points={known.map(({ value, index }) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')}
        fill="none"
        stroke={CHART_INK.context}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle cx={x(last.index)} cy={y(last.value)} r={4} fill={SERIES_COLORS[0]} stroke={CHART_INK.surface} strokeWidth={2} />
    </Svg>
  );
}

/** A headline number: its label, value, change against a named period, and a sparkline. */
export function StatTile({
  label,
  value,
  delta,
  period,
  values,
}: {
  label: string;
  value: string;
  delta: string;
  period: string;
  values: (number | null)[];
}) {
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 160,
        borderWidth: 1,
        borderColor: 'rgba(11,11,11,0.10)',
        borderRadius: 12,
        padding: 12,
        gap: 4,
        backgroundColor: CHART_INK.surface,
      }}
    >
      <Text style={{ fontSize: 13, color: CHART_INK.secondary }}>{label}</Text>
      <Text style={{ fontSize: 26, fontWeight: '700', color: CHART_INK.primary }}>{value}</Text>
      <Text style={{ fontSize: 13, color: CHART_INK.secondary }}>
        <Text style={{ fontWeight: '700', color: CHART_INK.primary }}>{delta}</Text> {period}
      </Text>
      <Sparkline values={values} />
    </View>
  );
}

/**
 * Areas ranked: one bar each, the highlighted area in the second color. In change mode the bars grow either
 * way from zero, blue for a fall and red for a rise.
 */
export function RankedBars({
  rows,
  highlight,
  mode,
  format,
  formatChange,
}: {
  rows: Ranked[];
  highlight: number;
  mode: 'value' | 'change';
  format: (value: number) => string;
  formatChange: (value: number | null) => string;
}) {
  const [width, onLayout] = useWidth();
  const labelWidth = Math.min(220, Math.max(140, width * 0.42));
  const valueWidth = 72;
  const plot = Math.max(1, width - labelWidth - valueWidth);
  const values = rows.map((row) => (mode === 'value' ? row.value : (row.change ?? 0)));
  const high = Math.max(0, ...values);
  const low = Math.min(0, ...values);
  const scale = (value: number) => (plot * value) / (high - low || 1);
  const zero = scale(-low);
  return (
    <View onLayout={onLayout} style={{ gap: 2 }}>
      {width > 0 &&
        rows.map((row, index) => {
          const value = values[index]!;
          const length = Math.max(2, Math.abs(scale(value)));
          const chosen = row.id === highlight;
          const color = mode === 'value' ? (chosen ? SERIES_COLORS[1] : SERIES_COLORS[0]) : divergingColor(value >= 0 ? 0.85 : -0.85);
          const start = mode === 'value' ? 0 : value >= 0 ? zero : zero - length;
          // A 4px rounded end on the data side; square where the bar meets its baseline.
          const r = Math.min(4, length / 2);
          const d =
            mode === 'value' || value >= 0
              ? `M${start},5h${length - r}a${r},${r} 0 0 1 ${r},${r}v${14 - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${length - r}z`
              : `M${start + length},5h-${length - r}a${r},${r} 0 0 0 -${r},${r}v${14 - 2 * r}a${r},${r} 0 0 0 ${r},${r}h${length - r}z`;
          return (
            <Pressable
              key={row.id}
              accessibilityLabel={`${index + 1}. ${row.name}, ${row.borough}: ${format(row.value)}, ${formatChange(row.change)} from a year earlier`}
              // Long neighborhood names wrap to a second line instead of being cut off.
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 26, paddingVertical: 2 }}
            >
              <Text
                numberOfLines={2}
                style={{
                  width: labelWidth,
                  paddingRight: 8,
                  fontSize: 13,
                  lineHeight: 16,
                  color: chosen ? CHART_INK.primary : CHART_INK.secondary,
                  fontWeight: chosen ? '700' : '400',
                }}
              >
                {index + 1}. {row.name}
              </Text>
              <Svg width={plot} height={24}>
                {mode === 'change' && <Line x1={zero} x2={zero} y1={0} y2={24} stroke={CHART_INK.axis} strokeWidth={1} />}
                <Path d={d} fill={color} />
              </Svg>
              <Text style={[{ width: valueWidth, textAlign: 'right', fontSize: 13, color: CHART_INK.primary }, tabular]}>
                {mode === 'value' ? format(row.value) : formatChange(row.change)}
              </Text>
            </Pressable>
          );
        })}
    </View>
  );
}

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Years (rows) by months (columns), each cell colored by its change from a year earlier. */
export function YearHeatmap({
  rows,
  extent,
  formatChange,
}: {
  rows: { year: string; cells: { month: string; inRange: boolean; value: number | null }[] }[];
  extent: number;
  formatChange: (value: number | null) => string;
}) {
  const [width, onLayout] = useWidth();
  const [hover, setHover] = useState<{ row: number; column: number } | null>(null);
  const labelWidth = 40;
  const gap = 2;
  const cellWidth = Math.max(8, (width - labelWidth) / 12);
  const cellHeight = 24;
  const showText = cellWidth >= 40;
  const cell = hover ? rows[hover.row]?.cells[hover.column] : undefined;
  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <Svg width={width} height={(rows.length + 1) * cellHeight}>
          {MONTHS.map((letter, column) => (
            <SvgText
              fontFamily={CHART_FONT}
              key={column}
              x={labelWidth + column * cellWidth + cellWidth / 2}
              y={14}
              fontSize={11}
              fill={CHART_INK.muted}
              textAnchor="middle"
            >
              {cellWidth >= 30 ? MONTH_NAMES[column] : letter}
            </SvgText>
          ))}
          {rows.map((row, rowIndex) => (
            <SvgText fontFamily={CHART_FONT} key={row.year} x={0} y={(rowIndex + 1) * cellHeight + 16} fontSize={11} fill={CHART_INK.muted}>
              {row.year}
            </SvgText>
          ))}
          {rows.flatMap((row, rowIndex) =>
            row.cells.map((item, column) => {
              const position = item.value === null ? null : divergingPosition(item.value, extent);
              const x = labelWidth + column * cellWidth;
              const y = (rowIndex + 1) * cellHeight;
              const active = hover?.row === rowIndex && hover.column === column;
              if (!item.inRange) return [];
              return [
                <Rect
                  key={item.month}
                  x={x}
                  y={y}
                  width={cellWidth - gap}
                  height={cellHeight - gap}
                  rx={3}
                  fill={position === null ? CHART_INK.surface : divergingColor(position)}
                  stroke={position === null ? CHART_INK.grid : active ? CHART_INK.primary : 'none'}
                  strokeWidth={1}
                />,
                showText && position !== null ? (
                  <SvgText
                    fontFamily={CHART_FONT}
                    key={item.month + 't'}
                    x={x + (cellWidth - gap) / 2}
                    y={y + 16}
                    fontSize={10}
                    fill={textOn(position)}
                    textAnchor="middle"
                  >
                    {formatChange(item.value).replace('%', '')}
                  </SvgText>
                ) : null,
              ];
            }),
          )}
        </Svg>
      )}
      {width > 0 && (
        <View
          onPointerMove={(event) => {
            const column = Math.floor((pointerX(event) - labelWidth) / cellWidth);
            const row = Math.floor(pointerY(event) / cellHeight) - 1;
            setHover(column >= 0 && column < 12 && row >= 0 && row < rows.length ? { row, column } : null);
          }}
          onPointerLeave={() => setHover(null)}
          style={{ position: 'absolute', left: 0, top: 0, width, height: (rows.length + 1) * cellHeight }}
        />
      )}
      {hover && cell?.inRange && (
        <Tooltip
          title={`${MONTH_NAMES[hover.column]} ${rows[hover.row]!.year}`}
          rows={[{ label: 'vs a year earlier', value: cell.value === null ? 'Not reported' : formatChange(cell.value) }]}
          left={
            labelWidth + hover.column * cellWidth > width / 2
              ? width - labelWidth - hover.column * cellWidth + 8
              : labelWidth + (hover.column + 1) * cellWidth + 4
          }
          top={(hover.row + 1) * cellHeight}
          alignRight={labelWidth + hover.column * cellWidth > width / 2}
        />
      )}
      <ScaleLegend extent={extent} formatChange={formatChange} />
    </View>
  );
}

/** The diverging scale's key: lower in blue, no change in gray, higher in red. */
function ScaleLegend({ extent, formatChange }: { extent: number; formatChange: (value: number | null) => string }) {
  const steps = [-1, -0.6, -0.25, 0, 0.25, 0.6, 1];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
      <Text style={[{ fontSize: 12, color: CHART_INK.secondary }, tabular]}>Lower {formatChange(-extent)}</Text>
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {steps.map((step) => (
          <View key={step} style={{ width: 18, height: 10, borderRadius: 2, backgroundColor: divergingColor(step) }} />
        ))}
      </View>
      <Text style={[{ fontSize: 12, color: CHART_INK.secondary }, tabular]}>Higher {formatChange(extent)}</Text>
    </View>
  );
}

/** Twelve columns from a zero line: how far each calendar month usually sits above or below its year's average. */
export function SeasonColumns({
  months,
  formatChange,
}: {
  months: { name: string; value: number | null }[];
  formatChange: (value: number | null) => string;
}) {
  const [width, onLayout] = useWidth();
  const height = 180;
  const values = months.map(({ value }) => value ?? 0);
  const extent = Math.max(0.5, ...values.map(Math.abs));
  // Room beyond the tallest bars for their value labels.
  const ticks = niceTicks(-extent * 1.3, extent * 1.3, 5);
  const top = 16;
  const bottom = 28;
  const left = 44;
  const plot = height - top - bottom;
  const low = Math.min(-extent * 1.3, ticks[0] ?? -extent);
  const high = Math.max(extent * 1.3, ticks.at(-1) ?? extent);
  const y = (value: number) => top + (plot * (high - value)) / (high - low);
  const band = (width - left) / 12;
  const barWidth = Math.min(24, band * 0.6);
  const highest = values.indexOf(Math.max(...values));
  const lowest = values.indexOf(Math.min(...values));
  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {ticks.map((tick) => (
            <Line
              key={tick}
              x1={left}
              x2={width}
              y1={y(tick)}
              y2={y(tick)}
              stroke={tick === 0 ? CHART_INK.axis : CHART_INK.grid}
              strokeWidth={1}
            />
          ))}
          {ticks.map((tick) => (
            <SvgText
              fontFamily={CHART_FONT}
              key={'t' + tick}
              x={left - 6}
              y={y(tick) + 4}
              fontSize={11}
              fill={CHART_INK.muted}
              textAnchor="end"
            >
              {formatChange(tick)}
            </SvgText>
          ))}
          {months.map((month, index) => {
            const value = month.value ?? 0;
            const x = left + index * band + (band - barWidth) / 2;
            const length = Math.max(1, Math.abs(y(value) - y(0)));
            const r = Math.min(4, length / 2);
            const d =
              value >= 0
                ? `M${x},${y(0)}v-${length - r}a${r},${r} 0 0 1 ${r},-${r}h${barWidth - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${length - r}z`
                : `M${x},${y(0)}v${length - r}a${r},${r} 0 0 0 ${r},${r}h${barWidth - 2 * r}a${r},${r} 0 0 0 ${r},-${r}v-${length - r}z`;
            const label = index === highest || index === lowest;
            return [
              <Path key={month.name} d={d} fill={divergingColor(value / extent)} />,
              <SvgText
                fontFamily={CHART_FONT}
                key={month.name + 'n'}
                x={x + barWidth / 2}
                y={height - 6}
                fontSize={11}
                fill={CHART_INK.muted}
                textAnchor="middle"
              >
                {band >= 30 ? month.name : month.name[0]}
              </SvgText>,
              label && month.value !== null ? (
                <SvgText
                  fontFamily={CHART_FONT}
                  key={month.name + 'v'}
                  x={x + barWidth / 2}
                  y={value >= 0 ? y(value) - 5 : y(value) + 13}
                  fontSize={11}
                  fontWeight="700"
                  fill={CHART_INK.primary}
                  textAnchor="middle"
                >
                  {formatChange(month.value)}
                </SvgText>
              ) : null,
            ];
          })}
        </Svg>
      )}
    </View>
  );
}

/**
 * One dot per neighborhood. The highlighted area and its borough's neighborhoods stand out; the rest are
 * context in gray. The pointer reads the nearest dot.
 */
export function ScatterChart({
  points,
  highlight,
  borough,
  xLabel,
  yLabel,
  formatX,
  formatY,
  quadrants,
}: {
  points: ScatterPoint[];
  highlight: number;
  borough: string;
  xLabel: string;
  yLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  /** Captions for the corners: rising with few price cuts (bottom right), falling with many (top left). */
  quadrants?: { heating: string; cooling: string };
}) {
  const [width, onLayout] = useWidth();
  const [hover, setHover] = useState<ScatterPoint | null>(null);
  const height = 300;
  const left = 52;
  const right = 12;
  const top = 12;
  const bottom = 40;
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const xTicks = niceTicks(Math.min(0, ...xs), Math.max(0, ...xs), 6);
  const yTicks = niceTicks(0, Math.max(...ys, 0.01), 5);
  const [x0, x1] = [Math.min(xTicks[0] ?? 0, ...xs), Math.max(xTicks.at(-1) ?? 1, ...xs)];
  const [y0, y1] = [0, Math.max(yTicks.at(-1) ?? 1, ...ys)];
  const px = (value: number) => left + ((width - left - right) * (value - x0)) / (x1 - x0 || 1);
  const py = (value: number) => top + ((height - top - bottom) * (y1 - value)) / (y1 - y0 || 1);
  const ordered = [...points].sort((a, b) => rank(a) - rank(b));
  function rank(point: ScatterPoint) {
    return point.id === highlight ? 2 : point.borough === borough ? 1 : 0;
  }
  const nearest = (cx: number, cy: number) => {
    let best: ScatterPoint | null = null;
    let distance = 24;
    for (const point of points) {
      const d = Math.hypot(px(point.x) - cx, py(point.y) - cy);
      if (d < distance) [best, distance] = [point, d];
    }
    return best;
  };
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && points.length > 0 && (
        <Svg width={width} height={height}>
          {yTicks.map((tick) => (
            <Line key={'y' + tick} x1={left} x2={width - right} y1={py(tick)} y2={py(tick)} stroke={CHART_INK.grid} strokeWidth={1} />
          ))}
          {yTicks.map((tick) => (
            <SvgText
              fontFamily={CHART_FONT}
              key={'yl' + tick}
              x={left - 6}
              y={py(tick) + 4}
              fontSize={11}
              fill={CHART_INK.muted}
              textAnchor="end"
            >
              {formatY(tick)}
            </SvgText>
          ))}
          {xTicks.map((tick) => (
            <SvgText
              fontFamily={CHART_FONT}
              key={'xl' + tick}
              x={px(tick)}
              y={height - bottom + 16}
              fontSize={11}
              fill={CHART_INK.muted}
              textAnchor="middle"
            >
              {formatX(tick)}
            </SvgText>
          ))}
          <Line x1={px(0)} x2={px(0)} y1={top} y2={height - bottom} stroke={CHART_INK.axis} strokeWidth={1} />
          <Line x1={left} x2={width - right} y1={py(0)} y2={py(0)} stroke={CHART_INK.axis} strokeWidth={1} />
          <SvgText
            fontFamily={CHART_FONT}
            x={(left + width - right) / 2}
            y={height - 4}
            fontSize={12}
            fill={CHART_INK.secondary}
            textAnchor="middle"
          >
            {xLabel}
          </SvgText>
          <SvgText fontFamily={CHART_FONT} x={left + 4} y={top + 10} fontSize={12} fill={CHART_INK.secondary}>
            {yLabel}
          </SvgText>
          {quadrants && width >= 560 && (
            <SvgText fontFamily={CHART_FONT} x={width - right - 4} y={py(0) - 8} fontSize={12} fill={CHART_INK.muted} textAnchor="end">
              {quadrants.heating}
            </SvgText>
          )}
          {quadrants && width >= 560 && (
            <SvgText fontFamily={CHART_FONT} x={left + 4} y={top + 28} fontSize={12} fill={CHART_INK.muted}>
              {quadrants.cooling}
            </SvgText>
          )}
          {ordered.map((point) => {
            const level = rank(point);
            return (
              <Circle
                key={point.id}
                cx={px(point.x)}
                cy={py(point.y)}
                r={level === 2 ? 7 : 4.5}
                fill={level === 2 ? SERIES_COLORS[1] : level === 1 || !borough ? SERIES_COLORS[0] : CHART_INK.context}
                stroke={hover?.id === point.id ? CHART_INK.primary : CHART_INK.surface}
                strokeWidth={2}
              />
            );
          })}
          {points
            .filter((point) => point.id === highlight)
            .map((point) => (
              <SvgText
                fontFamily={CHART_FONT}
                key="label"
                x={px(point.x) + 10}
                y={py(point.y) - 8}
                fontSize={12}
                fontWeight="700"
                fill={CHART_INK.primary}
              >
                {point.name}
              </SvgText>
            ))}
        </Svg>
      )}
      {width > 0 && (
        <View
          onPointerMove={(event) => setHover(nearest(pointerX(event), pointerY(event)))}
          onPointerDown={(event) => setHover(nearest(pointerX(event), pointerY(event)))}
          onPointerLeave={() => setHover(null)}
          style={{ position: 'absolute', left: 0, top: 0, width, height }}
        />
      )}
      {hover && (
        <Tooltip
          title={`${hover.name} · ${hover.borough}`}
          rows={[
            { label: xLabel, value: formatX(hover.x) },
            { label: yLabel, value: formatY(hover.y) },
          ]}
          left={px(hover.x) > width / 2 ? width - px(hover.x) + 12 : px(hover.x) + 12}
          top={Math.max(0, py(hover.y) - 30)}
          alignRight={px(hover.x) > width / 2}
        />
      )}
    </View>
  );
}
