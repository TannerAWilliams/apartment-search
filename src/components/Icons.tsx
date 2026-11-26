/** The app's few icons, drawn as SVG so they look the same on every device and size. Decorative: the label beside each says what it is. */
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { palette } from '../theme.ts';

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
 * Walkup's mark, which is also the name's first letter: a W that reads two ways, as a flat letter and as a flight
 * of stairs folding away from you (the dark faces are the risers, the pink ones the treads). In the header it stands
 * where the "w" would, as tall as the small letters beside it, followed by "alkup". Its dark faces are the page's
 * ink, so it follows the theme. The same drawing is the tab icon (public/icons/walkup.svg); the home-screen icons
 * put it on a dark tile.
 */
export function BrandMark({ size = 12.5 }: { size?: number }) {
  return (
    <Svg width={(size * 21) / 13.7} height={size} viewBox="0 0 21 13.7" aria-hidden>
      <Path d="M0 0l5.25 6.7v7L0 7zM10.5 0l5.25 6.7v7L10.5 7z" fill={palette.gray[9]} />
      <Path d="M5.25 6.7 10.5 0v7l-5.25 6.7zM15.75 6.7 21 0v7l-5.25 6.7z" fill={palette.rose[5]} />
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
/** A ticket: lotteries and public housing. */
export function TicketIcon({ color, size = 22 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M3 9V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6z" />
      <Path d="M14 6v2M14 11v2M14 16v2" />
    </Svg>
  );
}

export function BellIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
      <Path d="M10 20a2 2 0 0 0 4 0" />
    </Svg>
  );
}

export function CloseIcon({ color, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Path d="M5 5l14 14M19 5L5 19" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}
