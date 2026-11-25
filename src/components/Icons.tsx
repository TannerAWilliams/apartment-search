/** The app's few icons, drawn as SVG so they look the same on every device and size. Decorative: the label beside each says what it is. */
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

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
 * Walkup's mark at small sizes: a Brooklyn brownstone filling the icon, drawn bold enough to read in a browser
 * tab: an overhanging cornice, big windows, the red parlor door at the top of its stoop, and the railing. The same drawing
 * is the tab icon (public/icons/walkup.svg); the home-screen icons use a more detailed one (walkup-detailed.svg).
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <Defs>
        <ClipPath id="r">
          <Rect width={32} height={32} rx={7} />
        </ClipPath>
      </Defs>
      <G clipPath="url(#r)">
        <Rect width={32} height={32} fill="#f1e4cc" />
        <Rect x={3.5} y={5.5} width={25} height={26.5} fill="#6f3418" />
        <Rect x={2} y={2.5} width={28} height={4} rx={0.7} fill="#2b1206" />
        <G fill="#f6ead2">
          <Rect x={6} y={9} width={5.6} height={6} rx={0.5} />
          <Rect x={13.3} y={9} width={5.6} height={6} rx={0.5} />
          <Rect x={20.6} y={9} width={5.6} height={6} rx={0.5} />
          <Rect x={6} y={17.4} width={5.6} height={6.4} rx={0.5} />
          <Rect x={13.3} y={17.4} width={5.6} height={6.4} rx={0.5} />
        </G>
        <Path d="M21 23.8v-4.6a2.2 2.2 0 0 1 4.4 0v4.6z" fill="#d62a52" />
        <Path d="M19.8 23.8h7v2.2L16.4 32H8.6z" fill="#d9a882" />
        <Path d="M19.6 24 8.8 31.8" stroke="#1a0a03" strokeWidth={1.6} strokeLinecap="round" />
      </G>
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
