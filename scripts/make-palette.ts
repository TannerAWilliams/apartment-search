/**
 * Writes src/palette.ts: Walkup's colors as scales of ten levels, made the way Stripe describes in "Designing
 * accessible color systems" (stripe.com/blog/accessible-color-systems). Every hue has the same lightness at the
 * same level, measured in CIELAB (a model of how bright colors look to people, not to screens), so:
 * - any two levels five apart have at least 4.5:1 contrast, enough for small text;
 * - any two levels four apart have at least 3:1, enough for icons and large text;
 * - text at level 5 or darker passes on white and on the lightest tint (level 0) of every hue.
 * Each level takes as much of its hue's color as the screen can show, so the colors stay vivid, not muddy.
 * Run with `bun scripts/make-palette.ts`; test/palette.test.ts checks the promises above.
 */

/** Each level's contrast with white grows by this factor, so five levels make 4.6:1 (just over WCAG's 4.5). */
const STEP = 4.6 ** (1 / 5);
/** Level 0 sits a little below white, as a tint for backgrounds. */
const OFFSET = 0.2;
const LEVELS = 10;

/** Hue (CIELAB hue angle, degrees), the most chroma wanted, and how far the hue turns by the darkest level. */
const HUES: Record<string, { hue: number; chroma: number; turn?: number }> = {
  gray: { hue: 70, chroma: 2.2 },
  /** The accent: buttons, the selected tab, saved hearts. The rose the app has used. */
  rose: { hue: 18, chroma: 75 },
  /** The brownstone: the wordmark and the logo's building. */
  brown: { hue: 50, chroma: 42 },
  /** Good: deals, sources that work. */
  green: { hue: 150, chroma: 60 },
  /** Caution: notices, partial coverage. Turns toward orange as it darkens, as amber does. */
  amber: { hue: 80, chroma: 80, turn: -20 },
  /** Problems: errors, failed sources. */
  red: { hue: 32, chroma: 72 },
  /** Information and the map. */
  blue: { hue: 285, chroma: 65 },
  orange: { hue: 55, chroma: 75 },
  purple: { hue: 315, chroma: 55 },
  teal: { hue: 200, chroma: 40 },
};

// sRGB <-> CIELAB (D65).
const WHITE = [0.95047, 1, 1.08883];
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const finv = (t: number) => (t > 6 / 29 ? t ** 3 : 3 * (6 / 29) ** 2 * (t - 4 / 29));
function labToLinearRgb(L: number, a: number, b: number) {
  const fy = (L + 16) / 116;
  const [x, y, z] = [finv(fy + a / 500) * WHITE[0]!, finv(fy) * WHITE[1]!, finv(fy - b / 200) * WHITE[2]!];
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}
const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6);
/** CIELAB lightness for a relative luminance. */
const lightnessOf = (y: number) => (y > (6 / 29) ** 3 ? 116 * Math.cbrt(y) - 16 : (29 / 3) ** 3 * y);

function color(L: number, hue: number, chroma: number) {
  const angle = (hue * Math.PI) / 180;
  // The most chroma the screen can show at this lightness and hue, found by halving.
  let low = 0;
  let high = 150;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (inGamut(labToLinearRgb(L, mid * Math.cos(angle), mid * Math.sin(angle)))) low = mid;
    else high = mid;
  }
  const c = Math.min(chroma, low * 0.97);
  const rgb = labToLinearRgb(L, c * Math.cos(angle), c * Math.sin(angle)).map((v) => Math.min(1, Math.max(0, v)));
  return (
    '#' +
    rgb
      .map((v) =>
        Math.round(fromLinear(v) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** The luminance each level aims for: its contrast with white is STEP to the power of (level + OFFSET). */
const luminance = (level: number) => 1.05 / STEP ** (level + OFFSET) - 0.05;
// Rounding to 8-bit color moves luminance slightly; aim a hair darker so every promise still holds.
const lightness = Array.from({ length: LEVELS }, (_, level) => lightnessOf(luminance(level) * 0.985));

const scales = Object.fromEntries(
  Object.entries(HUES).map(([name, { hue, chroma, turn = 0 }]) => [
    name,
    lightness.map((L, level) => {
      // The palest and darkest levels hold less color, as real pigments do.
      const ends = level === 0 ? 0.18 : level === 1 ? 0.55 : level === LEVELS - 1 ? 0.7 : 1;
      return color(L, hue + (turn * level) / (LEVELS - 1), chroma * ends);
    }),
  ]),
);

const body = Object.entries(scales)
  .map(([name, values]) => `  ${name}: [${values.map((v) => `'${v}'`).join(', ')}],`)
  .join('\n');
await Bun.write(
  'src/palette.ts',
  `/**
 * Walkup's colors: ten levels per hue, 0 lightest to 9 darkest, with every hue equally light at each level
 * (written by scripts/make-palette.ts, after Stripe's "Designing accessible color systems"). The rules:
 * - Small text: at least five levels from its background (4.5:1). Text at level 5 or darker passes on white
 *   and on level 0 of any hue.
 * - Icons, large text and borders that must be seen: at least four levels apart (3:1).
 * - White text on level 5 or darker passes.
 * test/palette.test.ts checks every pair.
 */
export const palette = {
${body}
} as const;

export type Hue = keyof typeof palette;
`,
);
console.log(body);
