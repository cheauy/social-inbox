import { useEffect, useState } from "react";
import { ActivityIndicator, StyleProp, View, ViewStyle } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useMediaSource, type MediaSource } from "../lib/media";
import { cacheMedia, getCachedMedia, removeCachedMedia } from "../lib/media-cache";
import { stableMediaKey } from "../lib/media-key";

export function CachedVideo({ uri, style }: { uri: string; style?: StyleProp<ViewStyle> }) {
  const resolve = useMediaSource();
  const target = resolve(uri);
  return <Video key={JSON.stringify([uri, target?.cacheScope])} target={target} style={style} />;
}

function Video({ target, style }: { target: MediaSource | null; style?: StyleProp<ViewStyle> }) {
  const key = target ? stableMediaKey(target.uri) : "";
  const [source, setSource] = useState<MediaSource | null>(() => {
    const local = getCachedMedia(key, target?.cacheScope);
    return local ? { uri: local } : null;
  });
  useEffect(() => {
    let alive = true;
    if (!target) return;
    void cacheMedia(target.uri, key, target.headers, target.cacheScope, true).then(local => {
      if (alive) setSource(local ? { uri: local } : target);
    });
    return () => { alive = false; };
  }, [key, target?.uri, target?.cacheScope, target?.headers?.Cookie]);
  // TENH owns the bounded account/workspace cache; no second native cache.
  const player = useVideoPlayer(source ? { uri: source.uri, headers: source.headers, useCaching: false } : null, instance => instance.play());
  useEffect(() => {
    const listener = player.addListener("statusChange", ({ status }) => {
      if (status === "error" && source?.uri.startsWith("file:") && target && /^https?:/.test(target.uri)) {
        removeCachedMedia(key, target.cacheScope);
        setSource(target);
      }
    });
    return () => listener.remove();
  }, [player, source?.uri, key, target?.uri, target?.cacheScope]);
  return <View style={style}>
    {source ? <VideoView player={player} nativeControls contentFit="contain" style={{ width: "100%", height: "100%" }} />
      : <ActivityIndicator style={{ flex: 1 }} color="white" />}
  </View>;
}
