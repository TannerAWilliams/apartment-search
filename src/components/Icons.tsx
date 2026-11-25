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
 * Walkup's mark: a Brooklyn brownstone between its neighbors, with its bracketed cornice, tall windows under stone
 * hoods, and the parlor door at the top of a high stoop with its railing. The same drawing is the browser and
 * home-screen icon (public/icons/walkup.svg).
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
        <Rect x={0} y={6} width={6} height={26} fill="#c4997f" />
        <Rect x={26} y={5} width={6} height={27} fill="#b68a72" />
        <Rect x={1.2} y={9} width={3} height={4.2} fill="#f1e4cc" />
        <Rect x={1.2} y={15.5} width={3} height={4.2} fill="#f1e4cc" />
        <Rect x={27.8} y={8.5} width={3} height={4.2} fill="#f1e4cc" />
        <Rect x={27.8} y={15} width={3} height={4.2} fill="#f1e4cc" />
        <Rect x={6} y={4.2} width={20} height={27.8} fill="#7a3d22" />
        <Rect x={5.2} y={2.6} width={21.6} height={2.6} rx={0.4} fill="#3a1a0c" />
        <G fill="#3a1a0c">
          <Rect x={7} y={5.2} width={1.2} height={1.3} />
          <Rect x={12} y={5.2} width={1.2} height={1.3} />
          <Rect x={18.8} y={5.2} width={1.2} height={1.3} />
          <Rect x={23.8} y={5.2} width={1.2} height={1.3} />
        </G>
        <G fill="#3a1a0c">
          <Rect x={7.6} y={7.6} width={4.4} height={0.9} />
          <Rect x={13.8} y={7.6} width={4.4} height={0.9} />
          <Rect x={20} y={7.6} width={4.4} height={0.9} />
          <Rect x={7.6} y={13.4} width={4.4} height={0.9} />
          <Rect x={13.8} y={13.4} width={4.4} height={0.9} />
          <Rect x={20} y={13.4} width={4.4} height={0.9} />
        </G>
        <G fill="#f1e4cc">
          <Rect x={8} y={8.5} width={3.6} height={3.8} />
          <Rect x={14.2} y={8.5} width={3.6} height={3.8} />
          <Rect x={20.4} y={8.5} width={3.6} height={3.8} />
          <Rect x={8} y={14.3} width={3.6} height={5.2} />
          <Rect x={14.2} y={14.3} width={3.6} height={5.2} />
        </G>
        <Path d="M19.6 13.2h5.2l-0.6 1.1h-4z" fill="#3a1a0c" />
        <Path d="M20.4 20.6v-5a1.8 1.8 0 0 1 3.6 0v5z" fill="#2a1208" />
        <Path d="M19.6 20.6h5.4v1.5L14 31.4H6.6v-1.6z" fill="#a8603f" />
        <Path d="M19.4 20.6 7 31.2" stroke="#1f0d05" strokeWidth={1} strokeLinecap="round" />
        <Path d="M19.4 20.6v-2" stroke="#1f0d05" strokeWidth={1} strokeLinecap="round" />
        <G fill="#f1e4cc">
          <Rect x={8} y={22.2} width={2.6} height={3} />
        </G>
        <Rect x={0} y={31} width={32} height={1} fill="#5c5c5c" opacity={0.35} />
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
