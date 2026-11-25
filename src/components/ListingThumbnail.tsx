/**
 * A listing card's image area. Listings carry no photos, so it shows where the apartment is: the OpenStreetMap
 * tiles around it, with a pin on the spot in the middle. A listing without coordinates gets a plain tile with a building.
 */
import { createContext, useContext, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '../styles.ts';

const ZOOM = 15;

/** Whether the server can show Street View images (server/street-view.ts); the app sets it from its config. */
export const StreetViewContext = createContext(false);

/** The map tile holding a point at ZOOM, where in that tile (0 to 1 across and down) the point falls, and any tile's address. */
export function tileFor(latitude: number, longitude: number) {
  const scale = 2 ** ZOOM;
  const column = ((longitude + 180) / 360) * scale;
  const radians = (latitude * Math.PI) / 180;
  const row = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale;
  const x = Math.floor(column);
  const y = Math.floor(row);
  return {
    x,
    y,
    url: (column: number, line: number) => `https://tile.openstreetmap.org/${ZOOM}/${column}/${line}.png`,
    across: column - x,
    down: row - y,
  };
}

const thumbnail = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  pin: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    borderRadius: 9,
    backgroundColor: colors.green,
    borderWidth: 3,
    borderColor: colors.white,
  },
  credit: {
    position: 'absolute',
    right: 6,
    bottom: 4,
    fontSize: 9,
    lineHeight: 12,
    color: '#444',
    backgroundColor: '#ffffffcc',
    paddingHorizontal: 4,
    borderRadius: 3,
    overflow: 'hidden',
  },
});

export function ListingThumbnail({
  latitude,
  longitude,
  photo,
}: {
  latitude?: number | null;
  longitude?: number | null;
  /** The landlord's photo of the building, shown first when there is one. */
  photo?: string;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const streetView = useContext(StreetViewContext);
  // Street View first, when the server has it; no image there, or the month's free images used up, shows the map.
  const [streetViewFailed, setStreetViewFailed] = useState(false);
  if (photo && !photoFailed)
    return (
      <View style={StyleSheet.absoluteFill} aria-hidden>
        <Image source={{ uri: photo }} onError={() => setPhotoFailed(true)} resizeMode="cover" style={StyleSheet.absoluteFill} />
      </View>
    );
  const located = typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude);
  if (!located || failed)
    return (
      <View style={thumbnail.fill} aria-hidden>
        <Svg width={56} height={56} viewBox="0 0 32 32">
          <Rect x={9} y={6} width={11} height={20} rx={1} fill="#c9c9c9" />
          <Rect x={21} y={12} width={4} height={14} rx={0.5} fill="#dcdcdc" />
          <Path
            d="M11 10h2.5v2H11zM15.5 10H18v2h-2.5zM11 14h2.5v2H11zM15.5 14H18v2h-2.5zM11 18h2.5v2H11zM15.5 18H18v2h-2.5z"
            fill="#f7f7f7"
          />
        </Svg>
      </View>
    );
  if (streetView && Platform.OS === 'web' && !streetViewFailed)
    return (
      <View style={StyleSheet.absoluteFill} aria-hidden>
        <Image
          source={{ uri: `/api/street-view?lat=${latitude.toFixed(5)}&lng=${longitude.toFixed(5)}` }}
          onError={() => setStreetViewFailed(true)}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  const tile = tileFor(latitude, longitude);
  // Four tiles, each as wide as the card, from the side the apartment is nearer to, so the pin sits in the
  // middle of the card wherever it falls in its own tile.
  const { width, height } = size;
  const left = tile.across < 0.5 ? -1 : 0;
  const up = tile.down < 0.5 ? -1 : 0;
  const offsetX = width / 2 - (tile.across - left) * width;
  const offsetY = height / 2 - (tile.down - up) * width;
  return (
    <View
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
      aria-hidden
      onLayout={({ nativeEvent }) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
    >
      {width > 0 && (
        <>
          {[0, 1].flatMap((dy) =>
            [0, 1].map((dx) => (
              <Image
                key={`${dx}${dy}`}
                source={{ uri: tile.url(tile.x + left + dx, tile.y + up + dy) }}
                onError={() => setFailed(true)}
                style={{ position: 'absolute', left: offsetX + dx * width, top: offsetY + dy * width, width, height: width }}
              />
            )),
          )}
          <View style={[thumbnail.pin, { left: width / 2, top: height / 2 }]} />
          <Text style={thumbnail.credit}>© OpenStreetMap</Text>
        </>
      )}
    </View>
  );
}
