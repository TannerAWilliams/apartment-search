import { expect, test } from 'bun:test';
import { palette } from '../src/palette.ts';

const channel = (hex: string, at: number) => {
  const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
/** WCAG 2 contrast ratio. */
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const scales = Object.entries(palette);

test('every hue has ten levels, each darker than the last', () => {
  for (const [, levels] of scales) {
    expect(levels).toHaveLength(10);
    for (let i = 1; i < 10; i++) expect(luminance(levels[i]!)).toBeLessThan(luminance(levels[i - 1]!));
  }
});

test('any two levels five apart pass for small text, four apart for icons and large text, across hues', () => {
  for (const [, a] of scales)
    for (const [, b] of scales)
      for (let i = 0; i < 10; i++)
        for (let j = i + 4; j < 10; j++) expect(contrast(a[i]!, b[j]!)).toBeGreaterThanOrEqual(j - i >= 5 ? 4.5 : 3);
});

test('text at level 5 or darker passes on white and on the lightest tint of every hue; white text passes on it', () => {
  for (const [, text] of scales)
    for (let level = 5; level < 10; level++) {
      expect(contrast(text[level]!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      for (const [, background] of scales) expect(contrast(text[level]!, background[0]!)).toBeGreaterThanOrEqual(4.5);
    }
});
