import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Image, ImageStyle, StyleProp, View, ViewStyle } from "react-native";

import { cacheMedia } from "../lib/media-cache";
import { useMediaSource } from "../lib/media";

function stableImageKey(uri: string) {
  try {
    const url = new URL(uri);
    const storage = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (storage && url.origin === new URL(storage).origin && url.pathname.startsWith("/storage/v1/object/sign/")) {
      url.searchParams.delete("token");
      return url.href;
    }
  } catch { /* Local asset. */ }
  return uri;
}

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
  const targetScope = resolve(uri)?.cacheScope;
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    const target = resolve(uri);

    if (!target) {
      setSource(null);
      return;
    }

    setSource(null);
    if (!/^https?:\/\//.test(target.uri)) { setSource(target.uri); return; }

    void (async () => {
      const local = await cacheMedia(target.uri, cacheKey ?? stableImageKey(target.uri), target.headers, target.cacheScope);

      if (!alive) return;

      if (local) {
        setSource(local);
        return;
      }

      /*
       * No disk copy. A picture that needs no session can still be drawn from
       * its link; one that does has nothing left to try.
       */
      if (!target.headers) { setSource(target.uri); return; }

      setSource(null);
      setFailed(true);
      onError?.();
    })();

    return () => {
      alive = false;
    };
  }, [uri, cacheKey, targetScope]);

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
      source={source ? { uri: source } : undefined}
      resizeMode={resizeMode}
      onError={() => { setFailed(true); onError?.(); }}
      onLoad={(event) => {
        const { width, height } = event.nativeEvent.source;

        if (width > 0 && height > 0) {
          onLoad?.({ width, height });
        }
      }}
      style={style}
    />
  );
}
