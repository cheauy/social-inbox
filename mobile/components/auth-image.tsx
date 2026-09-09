import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { Image, ImageStyle, StyleProp } from "react-native";

import { useMediaSource } from "../lib/media";

/*
 * A picture that needs a session to fetch.
 *
 * Facebook writes absolute CDN links and React Native draws them directly.
 * Telegram cannot: its file URLs carry the bot token and expire, so TENH
 * proxies the bytes behind /api/messages/<id>/media, which answers 401 to
 * anyone without a session.
 *
 * Passing a Cookie header to <Image source={{uri, headers}}/> does not work
 * on Android -- the same request through fetch() returns 200 and the image
 * loader still gets nothing, because RN's loader goes through OkHttp's own
 * cookie jar and drops the header. That failure is silent: <Image/> has no
 * way to say "401", so every Telegram photo, sticker and video thumbnail
 * rendered as the tile's near-black placeholder and looked like a design
 * choice rather than a broken request.
 *
 * So the bytes are fetched the way everything else in this app fetches --
 * with the cookie -- written to the cache, and handed to <Image/> as a local
 * file. It downloads once per image per install; the second look is a disk
 * read.
 */

/* Its own folder, so clearing media never touches a staged upload. */
const FOLDER = "tenh-media";

/* A file name that is stable for a URL and safe on disk. */
function keyFor(uri: string) {
  let hash = 0;

  for (let index = 0; index < uri.length; index += 1) {
    hash = (Math.imul(hash, 31) + uri.charCodeAt(index)) | 0;
  }

  return "m" + (hash >>> 0).toString(36);
}

export function AuthImage({
  uri,
  style,
  resizeMode = "cover",
  onLoad,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: "cover" | "contain";
  onLoad?: (size: { width: number; height: number }) => void;
}) {
  const resolve = useMediaSource();
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const target = resolve(uri);

    if (!target) {
      setSource(null);
      return;
    }

    /* Nothing to authenticate: hand it straight over, as before. */
    if (!target.headers) {
      setSource(target.uri);
      return;
    }

    void (async () => {
      try {
        const folder = new Directory(Paths.cache, FOLDER);

        if (!folder.exists) {
          folder.create({ intermediates: true });
        }

        const file = new File(folder, keyFor(target.uri));

        if (file.exists) {
          if (alive) setSource(file.uri);
          return;
        }

        const saved = await File.downloadFileAsync(target.uri, file, {
          headers: target.headers,
          idempotent: true,
        });

        if (alive) setSource(saved.uri);
      } catch {
        /*
         * Left as the placeholder. A retry button on every tile would be
         * noise, and the thread reloads whenever the screen is reopened.
         */
        if (alive) setSource(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [uri]);

  return (
    <Image
      source={source ? { uri: source } : undefined}
      resizeMode={resizeMode}
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
