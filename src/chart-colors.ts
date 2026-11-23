/**
 * Chart colors. The categorical slots are used in this order and never cycled; the first four pass the palette
 * validator on the app's white surface (adjacent colorblind separation ΔE ≥ 9). Slots 3 and 4 are under 3:1
 * against white, so every chart that uses them also labels its lines and offers a table.
 */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;
export const CHART_INK = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  /** The gray that everything except the highlighted mark takes. */
  context: '#c9c8c1',
  surface: '#ffffff',
};

/** Blue (lower) to red (higher) through a neutral gray: a diverging scale. */
const NEUTRAL = [0xf0, 0xef, 0xec];
const LOWER = [0x25, 0x6a, 0xbf];
const HIGHER = [0xc9, 0x3a, 0x39];

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
