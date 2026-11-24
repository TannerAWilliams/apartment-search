/** Line icons for the Profile page's rows, drawn like the category icons so the app reads as one set. */
import Svg, { Circle, Path, Rect } from 'react-native-svg';

const line = (color: string) =>
  ({ stroke: color, strokeWidth: 1.7, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }) as const;

const DRAW: Record<string, (color: string) => React.ReactNode> = {
  saved: (c) => <Path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" {...line(c)} />,
  alerts: (c) => <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z M10 20.5a2 2 0 0 0 4 0" {...line(c)} />,
  shared: (c) => (
    <>
      <Circle cx={9} cy={8} r={3} {...line(c)} />
      <Circle cx={17} cy={9} r={2.4} {...line(c)} />
      <Path d="M3.5 19a5.5 5.5 0 0 1 11 0 M14.5 14.5a4.5 4.5 0 0 1 6 4.5" {...line(c)} />
    </>
  ),
  apply: (c) => <Path d="M7 3h7l4 4v14H7z M14 3v4h4 M10 12h5 M10 16h5" {...line(c)} />,
  neighborhoods: (c) => (
    <>
      <Path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z" {...line(c)} />
      <Circle cx={12} cy={10} r={2.2} {...line(c)} />
    </>
  ),
  renewal: (c) => <Path d="M19 12a7 7 0 1 1-2.1-5 M19 4v4h-4" {...line(c)} />,
  affordable: (c) => <Path d="M4 11l8-6 8 6 M6 10v10h12V10 M10 20v-5h4v5" {...line(c)} />,
  marketplaces: (c) => (
    <>
      <Circle cx={12} cy={12} r={8.5} {...line(c)} />
      <Path d="M3.5 12h17 M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" {...line(c)} />
    </>
  ),
  admin: (c) => <Path d="M4 20V10 M10 20V4 M16 20v-7 M22 20H2" {...line(c)} />,
  sources: (c) => <Path d="M4 12a8 8 0 0 1 13.7-5.6L20 9 M20 4v5h-5 M20 12a8 8 0 0 1-13.7 5.6L4 15 M4 20v-5h5" {...line(c)} />,
  terms: (c) => <Rect x={5} y={3} width={14} height={18} rx={2} {...line(c)} />,
};

export function MenuIcon({ name, color }: { name: string; color: string }) {
  const draw = DRAW[name];
  if (!draw) return null;
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" aria-hidden>
      {draw(color)}
    </Svg>
  );
}
