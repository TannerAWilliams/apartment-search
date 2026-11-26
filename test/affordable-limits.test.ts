import { expect, test } from 'bun:test';
import { BANDS, restrictionLines } from '../src/affordable-limits.ts';

test('a lottery says, for each income band it has apartments in, what one person may earn and the rent ceiling', () => {
  expect(restrictionLines([0, 0, 6, 0, 0], [0, 3, 3, 0, 0])).toEqual([
    'Low income (up to 80% of the area median): 6 apartments. One person may earn up to $95,040 a year. Rent: 1 BR up to $2,430, 2 BR up to $2,916.',
  ]);
  // One apartment, and a size the city's rent table does not cover.
  expect(restrictionLines([1, 0, 0, 0, 2], [0, 0, 0, 0, 3])).toEqual([
    'Extremely low income (up to 30% of the area median): 1 apartment. One person may earn up to $35,640 a year.',
    'Middle income (up to 165% of the area median): 2 apartments. One person may earn up to $196,020 a year.',
  ]);
  // A lottery saved before bands were kept says nothing rather than guessing.
  expect(restrictionLines(undefined, [1, 1, 0, 0, 0])).toEqual([]);
  expect(BANDS.map(({ share }) => share)).toEqual([30, 50, 80, 120, 165]);
});
