import { palette } from './palette.ts';
import { palette as themed, surface } from './theme.ts';

/**
 * Chart colors, from the palette's scales (src/palette.ts). The categorical slots are used in this order and never
 * cycled; all four pass the palette validator on white, and each has at least 3:1 contrast with it. Green and
 * orange are closest for red-green colorblind readers (ΔE 8.2), so charts that use both also label their lines.
 */
export const SERIES_COLORS = [palette.blue[5], palette.orange[4], palette.green[4], palette.purple[5]] as const;
/** Text, grid and surface follow the theme; the series colors are mid-levels that read on either surface. */
export const CHART_INK = {
  primary: themed.gray[9]!,
  secondary: themed.gray[7]!,
  muted: themed.gray[5]!,
  grid: themed.gray[1]!,
  axis: themed.gray[2]!,
  /** The gray that everything except the highlighted mark takes. */
  context: themed.gray[2]!,
  surface,
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
export const textOn = (position: number) => (Math.abs(position) > 0.55 ? '#ffffff' : palette.gray[9]);
