import { palette } from './palette.ts';

/**
 * Chart colors, from the palette's scales (src/palette.ts). The categorical slots are used in this order and never
 * cycled; all four pass the palette validator on white, and each has at least 3:1 contrast with it. Green and
 * orange are closest for red-green colorblind readers (ΔE 8.2), so charts that use both also label their lines.
 */
export const SERIES_COLORS = [palette.blue[5], palette.orange[4], palette.green[4], palette.purple[5]] as const;
export const CHART_INK = {
  primary: palette.gray[9],
  secondary: palette.gray[7],
  muted: palette.gray[5],
  grid: palette.gray[1],
  axis: palette.gray[2],
  /** The gray that everything except the highlighted mark takes. */
  context: palette.gray[2],
  surface: '#ffffff',
};

const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
/** Blue (lower) to red (higher) through a neutral gray: a diverging scale. */
const NEUTRAL = rgb(palette.gray[0]);
const LOWER = rgb(palette.blue[6]);
const HIGHER = rgb(palette.red[6]);

/** The color for a position from −1 (lower) through 0 (no change) to 1 (higher). */
export function divergingColor(position: number) {
  const t = Math.min(1, Math.abs(position));
  const pole = position < 0 ? LOWER : HIGHER;
  const channel = (index: number) =>
    Math.round(NEUTRAL[index]! + (pole[index]! - NEUTRAL[index]!) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Text that stays readable on a diverging fill: white on the strong ends, near-black elsewhere. */
export const textOn = (position: number) => (Math.abs(position) > 0.55 ? '#ffffff' : CHART_INK.primary);
