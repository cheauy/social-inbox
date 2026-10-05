import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, styles } from "./ui";
import { cachedMapTile, discardInvalidMapTile, loadMapTile, MAP_TILE_URL } from "../lib/map-tile-cache";

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
 * OpenStreetMap imagery is best-effort. Only the open, active viewport is
 * requested, with app identification and a seven-day local tile cache.
 * An unavailable map leaves the pin, coordinates and sending usable.
 */

/*
 * A {z}/{x}/{y} raster template, e.g.
 *   https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY
 * EXPO_PUBLIC_MAP_TILE_URL overrides OSM; an explicit empty string disables it.
 */
const TILE_URL = MAP_TILE_URL;

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
  sendError = "",
  sendBlocked = false,
  pendingPoint,
  onCheckDelivery,
  onSend,
  onClose,
}: {
  open: boolean;
  sending: boolean;
  sendError?: string;
  sendBlocked?: boolean;
  pendingPoint?: Point | null;
  onCheckDelivery?: () => void;
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
  const request = useRef(0);
  const openRef = useRef(open);
  const locatingRef = useRef(false);
  const cancelFix = useRef<(() => void) | null>(null);
  openRef.current = open;
  const [mapActive, setMapActive] = useState(AppState.currentState === "active");
  const [tileURIs, setTileURIs] = useState<Record<string, string>>({});
  const [tileErrors, setTileErrors] = useState<Record<string, boolean>>({});
  const [tileRetry, setTileRetry] = useState(0);
  const [mapLoading, setMapLoading] = useState(false);
  const tileController = useRef<AbortController | null>(null);
  const tileGeneration = useRef(0);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") tileController.current?.abort();
      setMapActive(state === "active");
    });
    return () => subscription.remove();
  }, []);

  function close() {
    tileGeneration.current++;
    tileController.current?.abort();
    request.current++;
    cancelFix.current?.(); cancelFix.current = null;
    locatingRef.current = false; setLocating(false);
    onClose();
  }

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

  /* Opening reads existing permission and the last known fix if granted.
   * It never prompts or starts a fresh GPS fix; that remains button-driven. */
  useEffect(() => {
    const sequence = ++request.current;
    const ownsResponse = () => openRef.current && request.current === sequence;
    locatingRef.current = false; setLocating(false); setLocateError("");
    if (open) void (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!ownsResponse()) return;
        if (!permission.granted) {
          setLocateError("TENH cannot see where this phone is. Allow location, or drag the pin.");
          return;
        }
        const position = await Location.getLastKnownPositionAsync();
        if (position && ownsResponse()) {
          setCentre({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        }
      } catch {
        if (ownsResponse()) setLocateError("Could not check this phone's location. Use my location to retry, or drag the pin.");
      }
    })();
    return () => {
      request.current++;
      cancelFix.current?.(); cancelFix.current = null;
      locatingRef.current = false;
    };
  }, [open]);

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
    if (!openRef.current || locatingRef.current) return;
    locatingRef.current = true;
    const sequence = ++request.current;
    const ownsResponse = () => openRef.current && request.current === sequence;
    setLocating(true);
    setLocateError("");

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!ownsResponse()) return;

      if (!permission.granted) {
        setLocateError(
          "TENH cannot see where this phone is. Allow location, or drag the pin.",
        );
        return;
      }

      const cached = await Location.getLastKnownPositionAsync();
      if (!ownsResponse()) return;

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
        new Promise<null>((resolve) => {
          const timer = setTimeout(() => resolve(null), 8000);
          cancelFix.current = () => { clearTimeout(timer); resolve(null); };
        }),
      ]);
      if (!ownsResponse()) return;

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
      if (!ownsResponse()) return;
      setLocateError(
        "Could not get a location fix. Check that location is on, or drag the pin.",
      );
    } finally {
      if (ownsResponse()) {
        cancelFix.current?.(); cancelFix.current = null;
        locatingRef.current = false; setLocating(false);
      }
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
      ty <= Math.min(count - 1, Math.ceil((top + size.height) / TILE) - 1);
      ty += 1
    ) {
      for (
        let tx = Math.floor(left / TILE);
        tx <= Math.ceil((left + size.width) / TILE) - 1;
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

  // Pixel movement within the same tile set does not restart downloads.
  const viewport = [...new Set(tiles.map((tile) => tile.url))].sort().join("\n");
  useEffect(() => {
    if (!open || !mapActive || !viewport) { setMapLoading(false); return; }
    const controller = new AbortController();
    tileGeneration.current++;
    tileController.current = controller;
    const urls = viewport.split("\n");
    const cached: Record<string, string> = {};
    urls.forEach((url) => { const uri = cachedMapTile(url); if (uri) cached[url] = uri; });
    setTileURIs(cached);
    setTileErrors({});
    const queue = urls.filter((url) => !cached[url]);
    setMapLoading(queue.length > 0);
    // Settle a pan before starting new requests; three downloads at most.
    const timer = setTimeout(() => {
      const worker = async () => {
        while (queue.length && !controller.signal.aborted) {
          const url = queue.shift()!;
          try {
            const uri = await loadMapTile(url, controller.signal);
            if (!controller.signal.aborted) setTileURIs((current) => ({ ...current, [url]: uri }));
          } catch {
            if (!controller.signal.aborted) setTileErrors((current) => ({ ...current, [url]: true }));
          }
        }
      };
      void Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker)).then(() => {
        if (!controller.signal.aborted) setMapLoading(false);
      });
    }, 150);
    return () => { tileGeneration.current++; clearTimeout(timer); controller.abort(); };
  }, [open, mapActive, viewport, tileRetry]);
  const mapFailed = tiles.some((tile) => tileErrors[tile.url]);
  const imageGeneration = tileGeneration.current;

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={close}
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
            onPress={close}
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
          {tiles.filter((tile) => tileURIs[tile.url] && !tileErrors[tile.url]).map((tile) => (
            <Image
              key={`${tile.url}:${tile.key}:${tileRetry}`}
              source={{ uri: tileURIs[tile.url] }}
              onError={() => {
                if (!openRef.current || tileGeneration.current !== imageGeneration || tileController.current?.signal.aborted) return;
                discardInvalidMapTile(tile.url, tileURIs[tile.url]);
                setTileErrors((current) => ({ ...current, [tile.url]: true }));
              }}
              style={{
                position: "absolute",
                left: tile.left,
                top: tile.top,
                width: TILE,
                height: TILE,
              }}
            />
          ))}

          {TILE_URL && (mapLoading || mapFailed) ? (
            <View style={{ position: "absolute", left: 12, right: 12, top: 12, padding: 12, borderRadius: 12, backgroundColor: "white", gap: 8 }}>
              <Text accessibilityRole={mapFailed ? "alert" : undefined} style={[styles.muted, { fontSize: 12.5 }]}>
                {mapFailed ? "Map unavailable. You can still send the selected coordinates or use your location." : "Loading map…"}
              </Text>
              {mapFailed ? <Pressable accessibilityRole="button" accessibilityLabel="Retry map" disabled={mapLoading} onPress={() => setTileRetry((current) => current + 1)}>
                <Text style={{ color: colors.blue, fontWeight: "700", opacity: mapLoading ? 0.5 : 1 }}>Retry map</Text>
              </Pressable> : null}
            </View>
          ) : null}

          {/* Explicitly disabled imagery still permits coordinate sending. */}
          {TILE_URL ? null : (
            <View
              style={{
                position: "absolute",
                left: 20,
                right: 20,
                top: 20,
                padding: 16,
                borderRadius: 16,
                backgroundColor: "white",
                borderWidth: 1,
                borderColor: colors.border,
                gap: 10,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Ionicons name="navigate-circle" size={18} color={colors.blue} />

                <Text
                  style={{ flex: 1, fontSize: 14.5, fontWeight: "800", color: colors.ink }}
                >
                  Send where this phone is
                </Text>
              </View>

              <Text style={[styles.muted, { fontSize: 12.5, lineHeight: 18 }]}>
                Map imagery is disabled in this build. The pin and coordinates
                still work, and you can use this phone's location.
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use where this phone is"
                disabled={locating}
                onPress={() => void goToMe()}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  paddingVertical: 11,
                  borderRadius: 12,
                  backgroundColor: pressed ? "#0A6FA8" : colors.blue,
                })}
              >
                {locating ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicons name="locate" size={16} color="white" />

                    <Text
                      style={{ fontSize: 14, fontWeight: "800", color: "white" }}
                    >
                      Use my location
                    </Text>
                  </>
                )}
              </Pressable>
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
          {TILE_URL ? <Pressable accessibilityRole="link" accessibilityLabel="OpenStreetMap copyright and contributors" onPress={() => { void Linking.openURL("https://www.openstreetmap.org/copyright").catch(() => {}); }}
            style={{ position: "absolute", left: 8, bottom: 8, backgroundColor: "white", padding: 5, borderRadius: 4 }}>
            <Text style={{ fontSize: 10.5, color: colors.ink }}>© OpenStreetMap contributors</Text>
          </Pressable> : null}
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
          {sendError || locateError ? <Text style={[styles.muted, { fontSize: 12.5 }]}>
            {centre.latitude.toFixed(5) + ", " + centre.longitude.toFixed(5)}
          </Text> : null}
          <Text
            accessibilityRole={sendError || locateError ? "alert" : undefined}
            style={[
              styles.muted,
              { fontSize: 12.5 },
              sendError || locateError ? { color: colors.red, lineHeight: 18 } : null,
            ]}
          >
            {sendError || locateError ||
              centre.latitude.toFixed(5) + ", " + centre.longitude.toFixed(5)}
          </Text>

          {pendingPoint ? <View style={{ gap: 10 }}>
            <Text accessibilityRole="alert" style={[styles.muted, { color: colors.red, lineHeight: 18 }]}>
              The location at {pendingPoint.latitude.toFixed(6)}, {pendingPoint.longitude.toFixed(6)} may already have been delivered. Check delivery, or verify in Telegram and contact TENH support. Sending another location stays blocked while this is unresolved.
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Check location delivery" disabled={sending} onPress={onCheckDelivery} style={styles.button}>
              <Text style={{ color: "white", fontWeight: "700" }}>Check delivery</Text>
            </Pressable>
          </View> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send this location"
            disabled={sending || sendBlocked}
            onPress={() =>
              onSend({
                latitude: Number(centre.latitude.toFixed(6)),
                longitude: Number(centre.longitude.toFixed(6)),
              })
            }
            style={({ pressed }) => [
              styles.button,
              { opacity: sending || sendBlocked ? 0.6 : pressed ? 0.8 : 1 },
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
