/**
 * Walkup's colors: ten levels per hue, 0 lightest to 9 darkest, with every hue equally light at each level
 * (written by scripts/make-palette.ts, after Stripe's "Designing accessible color systems"). The rules:
 * - Small text: at least five levels from its background (4.5:1). Text at level 5 or darker passes on white
 *   and on level 0 of any hue.
 * - Icons, large text and borders that must be seen: at least four levels apart (3:1).
 * - White text on level 5 or darker passes.
 * test/palette.test.ts checks every pair.
 */
export const palette = {
  gray: ['#f7f6f6', '#d7d5d3', '#bbb7b4', '#a19d9a', '#898582', '#73706d', '#5f5b59', '#4b4845', '#373432', '#201e1c'],
  rose: ['#fff4f4', '#fec8ca', '#fd9ea4', '#fc7081', '#f73b62', '#db164e', '#b70d3f', '#930831', '#6e0422', '#440211'],
  brown: ['#fff4f0', '#fdcbb5', '#f8a47e', '#da8a66', '#bf724f', '#a65d3b', '#8f4828', '#773516', '#5f2202', '#351501'],
  green: ['#e8fbec', '#a6e4b5', '#54cf7e', '#34b365', '#129a50', '#0d8143', '#096a36', '#065429', '#033e1d', '#01240d'],
  amber: ['#fff5e9', '#fecd89', '#f8a812', '#d98e0e', '#bd760a', '#a26107', '#894d04', '#6f3b03', '#542a02', '#301801'],
  red: ['#fff4f2', '#fec9c2', '#fd9f93', '#fd7367', '#ed4d47', '#d23234', '#b81122', '#940818', '#70040f', '#420701'],
  blue: ['#f5f6ff', '#cbd4fe', '#a2b5fd', '#749afc', '#4083f4', '#176dd9', '#115ab4', '#0b4791', '#06336d', '#021d43'],
  orange: ['#fff4ef', '#fecbb0', '#fda26e', '#f77b2c', '#da6310', '#b95106', '#994204', '#7a3303', '#5a2602', '#331701'],
  purple: ['#fbf4ff', '#ebc9fe', '#dba2fd', '#c086e4', '#a76fca', '#8f59b2', '#79449c', '#643186', '#4d1b70', '#2e0e44'],
  teal: ['#e6fbfb', '#9ee1e3', '#26ccd0', '#19afb3', '#139598', '#0e7d80', '#0a6669', '#065153', '#033c3d', '#012324'],
} as const;

export type Hue = keyof typeof palette;
