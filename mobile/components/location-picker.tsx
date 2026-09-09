import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, styles } from "./ui";

/*
 * Pick a point on a map and send it.
 *
 * "Send location" used to take the phone's own coordinates and go, which is
 * right about half the time: an agent arranging a delivery is usually naming
 * the shop, or a landmark near the customer, not the spot they happen to be
 * standing on. This is the web's picker, built the same way -- raster tiles
 * laid out by hand -- so it needs no map library and works in Expo Go.
 *
 * The pin does not move. The map moves under a pin fixed at the centre, which
 * is both easier to build and easier to aim than dragging a marker with the
 * thumb that is covering it.
 *
 * The imagery needs a tile provider, and there is deliberately no default.
 * The web draws these from OpenStreetMap's own servers, which is volunteer
 * infrastructure their usage policy reserves for exactly not this -- they
 * return a "tile usage policy" placeholder to apps, which is what an
 * unconfigured build would show. Without a URL the picker drops the imagery
 * and still does its job: the pin, the coordinates, "where I am", and send.
 */

/*
 * A {z}/{x}/{y} raster template, e.g.
 *   https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY
 * Set EXPO_PUBLIC_MAP_TILE_URL to switch the imagery on.
 */
const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL ?? "";

const TILE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

/* Web Mercator stops short of the poles; past this the projection diverges. */
const MAX_LATITUDE = 85.05112878;

type Point = { latitude: number; longitude: number };

const clampLatitude = (latitude: number) =>
  Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));

const worldSize = (zoom: number) => TILE * 2 ** zoom;

function toWorld({ latitude, longitude }: Point, zoom: number) {
  const size = worldSize(zoom);
  const lat = (clampLatitude(latitude) * Math.PI) / 180;

  return {
    x: ((longitude + 180) / 360) * size,
    y:
      ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * size,
  };
}

function fromWorld(x: number, y: number, zoom: number): Point {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * y) / size;

  return {
    longitude: (x / size) * 360 - 180,
    latitude: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
  };
}

export function LocationPicker({
  open,
  sending,
  onSend,
  onClose,
}: {
  open: boolean;
  sending: boolean;
  onSend: (point: Point) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  /* Phnom Penh, until the phone says otherwise. */
  const [centre, setCentre] = useState<Point>({
    latitude: 11.5564,
    longitude: 104.9282,
  });

  const [zoom, setZoom] = useState(15);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  const [asked, setAsked] = useState(false);

  /*
   * The drag is tracked in world pixels against where the gesture began, so a
   * long pan does not accumulate rounding the way a per-frame delta does.
   */
  const start = useRef({ x: 0, y: 0 });
  const live = useRef({ centre, zoom });

  live.current = { centre, zoom };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,

      onPanResponderGrant: () => {
        start.current = toWorld(live.current.centre, live.current.zoom);
      },

      onPanResponderMove: (_event, gesture) => {
        const { zoom: z } = live.current;
        const size = worldSize(z);

        const x = start.current.x - gesture.dx;
        const y = Math.max(
          0,
          Math.min(size, start.current.y - gesture.dy),
        );

        setCentre(fromWorld(((x % size) + size) % size, y, z));
      },
    }),
  ).current;

  /* Where the phone is, offered once when the picker opens. */
  useEffect(() => {
    if (!open || asked) {
      return;
    }

    setAsked(true);

    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();

      if (!permission.granted) {
        return;
      }

      try {
        const position = await Location.getLastKnownPositionAsync();

        if (position) {
          setCentre({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        }
      } catch {
        // The map opens over Phnom Penh; nothing here is worth an error line.
      }
    })();
  }, [open, asked]);

  /*
   * Where this phone is, in two steps.
   *
   * The cached fix first, because it is instant and almost always the right
   * street; then a fresh one to refine it. Asking only for a fresh fix is
   * what this did before, and getCurrentPositionAsync waits for the hardware
   * with no deadline of its own -- indoors, or on a device whose GPS has not
   * settled, the button span forever and the map never moved. The failure
   * arrived as nothing at all: no error, because nothing ever threw.
   */
  async function goToMe() {
    setLocating(true);
    setLocateError("");

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        setLocateError(
          "TENH cannot see where this phone is. Allow location, or drag the pin.",
        );
        return;
      }

      const cached = await Location.getLastKnownPositionAsync();

      if (cached) {
        setCentre({
          latitude: cached.coords.latitude,
          longitude: cached.coords.longitude,
        });
        setZoom(16);
      }

      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);

      if (fresh) {
        setCentre({
          latitude: fresh.coords.latitude,
          longitude: fresh.coords.longitude,
        });
        setZoom(16);
        return;
      }

      if (!cached) {
        setLocateError(
          "Could not get a location fix. Check that location is on, or drag the pin.",
        );
      }
    } catch {
      setLocateError(
        "Could not get a location fix. Check that location is on, or drag the pin.",
      );
    } finally {
      setLocating(false);
    }
  }

  const tiles = useMemo(() => {
    if (!TILE_URL || size.width === 0 || size.height === 0) {
      return [];
    }

    const world = toWorld(centre, zoom);
    const left = world.x - size.width / 2;
    const top = world.y - size.height / 2;
    const count = 2 ** zoom;

    const out: {
      key: string;
      url: string;
      left: number;
      top: number;
    }[] = [];

    for (
      let ty = Math.max(0, Math.floor(top / TILE));
      ty <= Math.min(count - 1, Math.floor((top + size.height) / TILE));
      ty += 1
    ) {
      for (
        let tx = Math.floor(left / TILE);
        tx <= Math.floor((left + size.width) / TILE);
        tx += 1
      ) {
        // The world wraps east to west; the tile index has to wrap with it.
        const wrapped = ((tx % count) + count) % count;

        out.push({
          key: `${tx}:${ty}`,
          url: TILE_URL.replace("{z}", String(zoom))
            .replace("{x}", String(wrapped))
            .replace("{y}", String(ty)),
          left: tx * TILE - left,
          top: ty * TILE - top,
        });
      }
    }

    return out;
  }, [centre, zoom, size]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + 14, flexDirection: "row", gap: 12 },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the map"
            onPress={onClose}
            hitSlop={10}
          >
            <Ionicons name="close" size={24} color={colors.ink} />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>Send location</Text>
            <Text style={[styles.muted, { fontSize: 12.5 }]}>
              Drag the map to put the pin where you mean.
            </Text>
          </View>
        </View>

        <View
          {...pan.panHandlers}
          onLayout={(event) => setSize(event.nativeEvent.layout)}
          style={{ flex: 1, overflow: "hidden", backgroundColor: "#E8EDF2" }}
        >
          {tiles.map((tile) => (
            <Image
              key={tile.key}
              source={{ uri: tile.url }}
              style={{
                position: "absolute",
                left: tile.left,
                top: tile.top,
                width: TILE,
                height: TILE,
              }}
            />
          ))}

          {/*
            Said once, plainly, rather than leaving somebody to wonder why the
            map is blank. Everything else on this screen still works.
          */}
          {TILE_URL ? null : (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 24,
                right: 24,
                top: 24,
                padding: 14,
                borderRadius: 14,
                backgroundColor: "white",
                borderWidth: 1,
                borderColor: colors.border,
                gap: 4,
              }}
            >
              <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>
                No map imagery configured
              </Text>

              <Text style={[styles.muted, { fontSize: 12.5, lineHeight: 18 }]}>
                Set EXPO_PUBLIC_MAP_TILE_URL to a tile provider to see the map.
                You can still drag to move the pin, or use the button below to
                jump to where this phone is.
              </Text>
            </View>
          )}

          {/*
            The pin sits at the centre and never moves; the map moves under
            it. Offset by its own height so the point of it, not its middle,
            marks the spot.
          */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: size.width / 2 - 18,
              top: size.height / 2 - 36,
            }}
          >
            <Ionicons name="location" size={36} color={colors.red} />
          </View>

          <View
            style={{
              position: "absolute",
              right: 12,
              bottom: 12,
              gap: 10,
              alignItems: "center",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Centre on where I am"
              onPress={() => void goToMe()}
              style={mapButton}
            >
              {locating ? (
                <ActivityIndicator color={colors.blue} />
              ) : (
                <Ionicons name="locate" size={20} color={colors.blue} />
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onPress={() => setZoom((current) => Math.min(MAX_ZOOM, current + 1))}
              style={mapButton}
            >
              <Ionicons name="add" size={22} color={colors.ink} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onPress={() => setZoom((current) => Math.max(MIN_ZOOM, current - 1))}
              style={mapButton}
            >
              <Ionicons name="remove" size={22} color={colors.ink} />
            </Pressable>
          </View>
        </View>

        <View
          style={{
            padding: 16,
            paddingBottom: 16 + insets.bottom,
            gap: 12,
            backgroundColor: "white",
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          {/*
            The coordinates, and anything that went wrong reaching for them.
            A button that spins and then does nothing is the worst of the
            three outcomes, because it is indistinguishable from a slow one.
          */}
          <Text
            accessibilityRole={locateError ? "alert" : undefined}
            style={[
              styles.muted,
              { fontSize: 12.5 },
              locateError ? { color: colors.red, lineHeight: 18 } : null,
            ]}
          >
            {locateError ||
              centre.latitude.toFixed(5) + ", " + centre.longitude.toFixed(5)}
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={sending}
            onPress={() =>
              onSend({
                latitude: Number(centre.latitude.toFixed(6)),
                longitude: Number(centre.longitude.toFixed(6)),
              })
            }
            style={({ pressed }) => [
              styles.button,
              { opacity: sending ? 0.6 : pressed ? 0.8 : 1 },
            ]}
          >
            {sending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
                Send this location
              </Text>
            )}
          </Pressable>

          {/*
            Whoever is serving the tiles is doing the work and almost always
            requires saying so.
          */}
          {TILE_URL ? (
            <Text
              style={[styles.muted, { fontSize: 10.5, textAlign: "center" }]}
            >
              Map data © OpenStreetMap contributors
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const mapButton = {
  width: 42,
  height: 42,
  borderRadius: 21,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  backgroundColor: "white",
  borderWidth: 1,
  borderColor: colors.border,
};
