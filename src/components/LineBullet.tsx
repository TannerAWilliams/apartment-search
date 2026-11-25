/** Subway lines as the MTA draws them: a colored circle with the line's letter or number. */
import { Text, View } from 'react-native';

/** The MTA's bullet colors for each line, and the text color that reads on it. */
export function lineColors(line: string): [string, string] {
  if (line.length === 1 && '123'.includes(line)) return ['#EE352E', '#ffffff'];
  if (line.length === 1 && '456'.includes(line)) return ['#00933C', '#ffffff'];
  if (line === '7') return ['#B933AD', '#ffffff'];
  if (line.length === 1 && 'ACE'.includes(line)) return ['#0039A6', '#ffffff'];
  if (line.length === 1 && 'BDFM'.includes(line)) return ['#FF6319', '#ffffff'];
  if (line === 'G') return ['#6CBE45', '#ffffff'];
  if (line.length === 1 && 'JZ'.includes(line)) return ['#996633', '#ffffff'];
  if (line === 'L') return ['#A7A9AC', '#222222'];
  if (line.length === 1 && 'NQRW'.includes(line)) return ['#FCCC0A', '#222222'];
  return ['#808183', '#ffffff'];
}

export function LineBullet({ line, size = 20 }: { line: string; size?: number }) {
  const [background, color] = lineColors(line);
  return (
    <View
      accessibilityLabel={`${line} train`}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color, fontWeight: '700', fontSize: size * 0.6, lineHeight: size * 0.75 }}>{line}</Text>
    </View>
  );
}

/** A station's lines in a row. */
export function LineBullets({ routes, size = 20 }: { routes: readonly string[]; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}>
      {routes.map((line) => (
        <LineBullet key={line} line={line} size={size} />
      ))}
    </View>
  );
}
