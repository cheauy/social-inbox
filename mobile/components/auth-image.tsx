import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Image, type ImageSource } from "expo-image";
import { ImageStyle, StyleProp, View, ViewStyle } from "react-native";

import { cacheMedia, getCachedMedia, removeCachedMedia } from "../lib/media-cache";
import { useMediaSource } from "../lib/media";
import { stableMediaKey as stableImageKey } from "../lib/media-key";

// Images use one scoped disk download rather than a simultaneous native fetch.
export function AuthImage(props: Parameters<typeof CachedImage>[0]) {
  const resolve = useMediaSource();
  return <CachedImage key={JSON.stringify([resolve(props.uri)?.cacheScope, props.uri])} {...props} />;
}

function CachedImage({
  uri,
  style,
  resizeMode = "cover",
  cacheKey,
  onLoad,
  onError,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
  /*
   * What to file the download under, when the URL itself is not stable.
   *
   * A saved reply's picture arrives behind a signed link that is minted fresh
   * on every request, so keying the cache on the URL means downloading the
   * same photo again every time the picker is opened. Callers that know the
   * underlying file -- a storage path, an attachment id -- pass it here.
   */
  cacheKey?: string;
  onError?: () => void;
  onLoad?: (size: { width: number; height: number }) => void;
}) {
  const resolve = useMediaSource();
  const resolved = resolve(uri);
  const targetScope = resolved?.cacheScope;
  const sessionHeader = resolved?.headers?.Cookie;
  const [source, setSource] = useState<ImageSource | null>(() => {
    const local = resolved && getCachedMedia(cacheKey ?? stableImageKey(resolved.uri), targetScope);
    return local ? { uri: local } : null;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    const target = resolve(uri);

    if (!target) {
      setSource(null);
      return;
    }

    const cached = getCachedMedia(cacheKey ?? stableImageKey(target.uri), target.cacheScope);
    if (cached) { setSource({ uri: cached }); return; }
    setSource(null);
    if (!/^https?:\/\//.test(target.uri)) { setSource({ uri: target.uri }); return; }

    void (async () => {
      const local = await cacheMedia(target.uri, cacheKey ?? stableImageKey(target.uri), target.headers, target.cacheScope);

      if (!alive) return;

      if (local) {
        setSource({ uri: local });
        return;
      }

      // Cache storage is optional. Preserve authentication when falling back
      // to the native image loader (private Telegram media and avatar routes).
      setSource({ uri: target.uri, headers: target.headers });
    })();

    return () => {
      alive = false;
    };
  }, [uri, cacheKey, targetScope, sessionHeader]);

  /*
   * A broken picture says it is broken.
   *
   * <Image/> with nothing to draw is an empty box, which is exactly what a
   * picture still downloading looks like -- so a thumbnail that had failed
   * read as one that was taking a long time, for ever.
   */
  if (failed) {
    return (
      <View
        style={[
          { alignItems: "center", justifyContent: "center" },
          style as StyleProp<ViewStyle>,
        ]}
      >
        <Ionicons name="image-outline" size={18} color="#6D7E91" />
      </View>
    );
  }

  return (
    <Image
      source={source ?? undefined}
      contentFit={resizeMode}
      // TENH's disk cache handles account isolation, size limits and logout.
      // Avoid a second, unscoped native cache of private customer photos.
      cachePolicy="none"
      recyclingKey={JSON.stringify([targetScope, uri])}
      onError={() => {
        const target = resolve(uri);
        if (target && /^https?:\/\//.test(target.uri) && source?.uri?.startsWith("file:")) {
          // Recover once from an evicted/corrupt disk image. Next load can
          // download it again; never cache a broken copy for the entire day.
          removeCachedMedia(cacheKey ?? stableImageKey(target.uri), target.cacheScope);
          setSource({ uri: target.uri, headers: target.headers });
          return;
        }
        setFailed(true);
        onError?.();
      }}
      onLoad={(event) => {
        const { width, height } = event.source;

        if (width > 0 && height > 0) {
          onLoad?.({ width, height });
        }
      }}
      style={style}
    />
  );
}
