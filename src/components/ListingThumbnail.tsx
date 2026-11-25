/**
 * A listing card's image area. Listings carry no photos, so it shows where the apartment is: the streets around it in
 * OpenFreeMap's Liberty style, as the map is (OpenStreetMap's tiles where that cannot be drawn), with a pin on the
 * spot in the middle. A listing without coordinates gets a plain tile with a building.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { libertySnapshot } from './liberty-snapshot.tsx';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '../styles.ts';

/**
 * OpenStreetMap's tiles are 256 pixels with no sharper version, so they are drawn at 192 points, close to their
 * own size: crisp on ordinary screens and only 1.5 times enlarged on sharp ones (stretched to a whole card they
 * were nearly three times, and blurred). Zoom 16 shows about two blocks around the apartment on a card.
 */
const ZOOM = 16;
const TILE = 192;

/** Whether the server can show Street View images (server/street-view.ts); the app sets it from its config. */
export const StreetViewContext = createContext(false);

/** Where a point falls on the map at ZOOM, in tiles (fractions are within a tile), and any tile's address. */
export function tileFor(latitude: number, longitude: number) {
  const scale = 2 ** ZOOM;
  const radians = (latitude * Math.PI) / 180;
  return {
    column: ((longitude + 180) / 360) * scale,
    row: ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale,
    url: (column: number, line: number) => `https://tile.openstreetmap.org/${ZOOM}/${column}/${line}.png`,
  };
}

/** The tiles that cover a box `width` by `height` centered on the point, each with its place in the box. */
export function tilesAround(latitude: number, longitude: number, width: number, height: number) {
  const { column, row, url } = tileFor(latitude, longitude);
  const left = column * TILE - width / 2;
  const top = row * TILE - height / 2;
  const tiles: { key: string; uri: string; x: number; y: number }[] = [];
  for (let x = Math.floor(left / TILE); x * TILE < left + width; x++)
    for (let y = Math.floor(top / TILE); y * TILE < top + height; y++)
      tiles.push({ key: `${x}/${y}`, uri: url(x, y), x: x * TILE - left, y: y * TILE - top });
  return tiles;
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
  // The card's Liberty picture: drawn once the card has its size; 'failed' shows OpenStreetMap's tiles instead.
  const [liberty, setLiberty] = useState<string>('pending');
  const located = typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude);
  const wanted = located && !(photo && !photoFailed) && !(streetView && Platform.OS === 'web' && !streetViewFailed);
  useEffect(() => {
    if (!wanted || size.width === 0) return;
    let current = true;
    libertySnapshot(latitude as number, longitude as number, size.width, size.height)
      .then((picture) => current && setLiberty(picture))
      .catch(() => current && setLiberty('failed'));
    return () => {
      current = false;
    };
  }, [wanted, latitude, longitude, size.width, size.height]);
  if (photo && !photoFailed)
    return (
      <View style={StyleSheet.absoluteFill} aria-hidden>
        <Image source={{ uri: photo }} onError={() => setPhotoFailed(true)} resizeMode="cover" style={StyleSheet.absoluteFill} />
      </View>
    );
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
  const { width, height } = size;
  return (
    <View
      style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: '#f2efe9' }]}
      aria-hidden
      onLayout={({ nativeEvent }) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
    >
      {/* The Liberty picture once drawn; until then a plain ground, and street tiles if it cannot be drawn. */}
      {width > 0 && liberty === 'pending' && <View style={[thumbnail.pin, { left: width / 2, top: height / 2 }]} />}
      {width > 0 && typeof liberty === 'string' && liberty !== 'pending' && liberty !== 'failed' && (
        <>
          <Image source={{ uri: liberty }} style={StyleSheet.absoluteFill} />
          <View style={[thumbnail.pin, { left: width / 2, top: height / 2 }]} />
          <Text style={thumbnail.credit}>© OpenFreeMap © OpenStreetMap</Text>
        </>
      )}
      {width > 0 && liberty === 'failed' && (
        <>
          {tilesAround(latitude, longitude, width, height).map((tile) => (
            <Image
              key={tile.key}
              source={{ uri: tile.uri }}
              onError={() => setFailed(true)}
              style={{ position: 'absolute', left: tile.x, top: tile.y, width: TILE, height: TILE }}
            />
          ))}
          <View style={[thumbnail.pin, { left: width / 2, top: height / 2 }]} />
          <Text style={thumbnail.credit}>© OpenStreetMap</Text>
        </>
      )}
    </View>
  );
}
