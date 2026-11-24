/** The app's few icons, drawn as SVG so they look the same on every device and size. Decorative: the label beside each says what it is. */
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

type IconProps = { color: string; size?: number; filled?: boolean };

export function SearchIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Circle cx={10.5} cy={10.5} r={6.5} stroke={color} strokeWidth={2} fill="none" />
      <Line x1={15.5} y1={15.5} x2={20.5} y2={20.5} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function HeartIcon({ color, size = 22, filled = false }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Path
        d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        fill={filled ? color : 'none'}
      />
    </Svg>
  );
}

export function MenuIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {[6, 12, 18].map((y) => (
        <Line key={y} x1={4} y1={y} x2={20} y2={y} stroke={color} strokeWidth={2} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

export function ChartIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Path d="M4 19.5h16" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M5 15l4.5-4.5 3.5 3 6-6.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/**
 * Walkup's mark: a walk-up building, three rows of windows and a door, above its stoop. The same drawing is the
 * home-screen icon (public/icons/walkup.svg).
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <Rect x={0} y={0} width={32} height={32} rx={8} fill="#d62a52" />
      <Rect x={9} y={5} width={14} height={17} rx={1.5} fill="#ffffff" />
      {[7.5, 11, 14.5].flatMap((y) =>
        [11.5, 17].map((x) => <Rect key={`${x}-${y}`} x={x} y={y} width={3.5} height={2.4} rx={0.5} fill="#d62a52" />),
      )}
      <Path d="M14.25 22V19.55a1.75 1.75 0 0 1 3.5 0V22Z" fill="#d62a52" />
      <Rect x={12.5} y={22.6} width={7} height={1.4} rx={0.4} fill="#ffffff" />
      <Rect x={11} y={24.4} width={10} height={1.4} rx={0.4} fill="#ffffff" />
      <Rect x={9.5} y={26.2} width={13} height={1.4} rx={0.4} fill="#ffffff" />
    </Svg>
  );
}
