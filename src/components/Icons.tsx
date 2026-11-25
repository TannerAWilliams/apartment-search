/** The app's few icons, drawn as SVG so they look the same on every device and size. Decorative: the label beside each says what it is. */
import Svg, { Circle, Line, Path, Rect, G } from 'react-native-svg';

type IconProps = { color: string; size?: number; filled?: boolean; fill?: string };

export function SearchIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Circle cx={10.5} cy={10.5} r={6.5} stroke={color} strokeWidth={2} fill="none" />
      <Line x1={15.5} y1={15.5} x2={20.5} y2={20.5} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function HeartIcon({ color, size = 22, filled = false, fill }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Path
        d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        fill={filled ? color : (fill ?? 'none')}
      />
    </Svg>
  );
}

export function ProfileIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} fill="none" />
      <Circle cx={12} cy={10} r={3} stroke={color} strokeWidth={2} fill="none" />
      <Path d="M6.5 18.2a6.5 6.5 0 0 1 11 0" stroke={color} strokeWidth={2} strokeLinecap="round" fill="none" />
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
 * Walkup's mark: a Brooklyn brownstone, with its cornice, windows under stone lintels, and the arched door at the
 * top of a high stoop. The same drawing is the browser and home-screen icon (public/icons/walkup.svg).
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <Rect width={32} height={32} rx={8} fill="#8b4a2b" />
      <Rect x={2.5} y={3.6} width={27} height={2.6} rx={0.5} fill="#4a2414" />
      <Rect x={3.5} y={6.2} width={25} height={0.9} fill="#b36a43" />
      <G fill="#4a2414">
        <Rect x={5} y={8.6} width={6} height={1} />
        <Rect x={13} y={8.6} width={6} height={1} />
        <Rect x={21} y={8.6} width={6} height={1} />
        <Rect x={5} y={14.3} width={6} height={1} />
        <Rect x={13} y={14.3} width={6} height={1} />
      </G>
      <G fill="#f6e7c8">
        <Rect x={5.6} y={9.6} width={4.8} height={3.6} rx={0.3} />
        <Rect x={13.6} y={9.6} width={4.8} height={3.6} rx={0.3} />
        <Rect x={21.6} y={9.6} width={4.8} height={3.6} rx={0.3} />
        <Rect x={5.6} y={15.3} width={4.8} height={5.4} rx={0.3} />
        <Rect x={13.6} y={15.3} width={4.8} height={5.4} rx={0.3} />
      </G>
      <Path d="M21.4 21V16.6a2.6 2.6 0 0 1 5.2 0V21Z" fill="#2e150a" />
      <Path d="M21 16.6a3 3 0 0 1 6 0" stroke="#4a2414" strokeWidth={1} fill="none" />
      <G fill="#d8a07a">
        <Rect x={19.6} y={21} width={8.2} height={1.3} rx={0.3} />
        <Rect x={18.2} y={22.9} width={9.6} height={1.3} rx={0.3} />
        <Rect x={16.8} y={24.8} width={11} height={1.3} rx={0.3} />
        <Rect x={15.4} y={26.7} width={12.4} height={1.3} rx={0.3} />
      </G>
      <Path d="M20.6 18.6 15.2 27.6" stroke="#2e150a" strokeWidth={0.9} strokeLinecap="round" />
      <Path d="M15.2 27.6v1.6" stroke="#2e150a" strokeWidth={0.9} strokeLinecap="round" />
      <Rect x={4.2} y={22.2} width={9.4} height={0.9} fill="#4a2414" />
      <Rect x={5.6} y={23.6} width={2} height={4.8} rx={0.3} fill="#f6e7c8" opacity={0.85} />
      <Rect x={9.6} y={23.6} width={2} height={4.8} rx={0.3} fill="#f6e7c8" opacity={0.85} />
    </Svg>
  );
}

/** Filters: three sliders. */
export function SlidersIcon({ color, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {[6, 12, 18].map((y) => (
        <Path key={y} d={`M3 ${y}h18`} stroke={color} strokeWidth={2} strokeLinecap="round" />
      ))}
      {[
        [9, 6],
        [16, 12],
        [7, 18],
      ].map(([x, y]) => (
        <Circle key={x} cx={x} cy={y} r={2.6} fill="#ffffff" stroke={color} strokeWidth={2} />
      ))}
    </Svg>
  );
}

/** Map: a folded map. */
export function MapIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Path
        d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z M9 4v13.5 M15 6.5V20"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** List: three lines with bullets. */
export function ListIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {[6, 12, 18].map((y) => (
        <Path key={y} d={`M9 ${y}h12 M4 ${y}h.01`} stroke={color} strokeWidth={2.4} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

/** Close: an X. */
export function CloseIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Path d="M5 5l14 14M19 5L5 19" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}
