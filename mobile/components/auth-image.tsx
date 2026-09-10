import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Image, ImageStyle, StyleProp, View, ViewStyle } from "react-native";

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
  cacheKey,
  onLoad,
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
  onLoad?: (size: { width: number; height: number }) => void;
}) {
  const resolve = useMediaSource();
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

    /*
     * Nothing to authenticate and nothing to file it under: hand it straight
     * to <Image/>, as before.
     *
     * A cacheKey changes that. It means the caller knows what this picture is
     * -- a storage path, an attachment id -- and that its address will be
     * different tomorrow. A quick reply's photo is the case: every open mints
     * a fresh signed link, so RN's own cache never recognised it and every
     * open of the picker downloaded the same size chart again, with the tiles
     * grey until it landed. Filed on disk under something stable, the second
     * open is a disk read and there is nothing to watch.
     */
    if (!target.headers && !cacheKey) {
      setSource(target.uri);
      return;
    }

    /*
     * While the disk copy is being fetched, draw the link itself.
     *
     * Only for a picture that needs no session -- a signed storage link is
     * readable as-is, so there is no reason to make somebody watch a grey
     * square during the very first download. A proxied one has no such
     * option: <Image/> drops the cookie, which is the whole reason this
     * component exists.
     */
    if (!target.headers) {
      setSource(target.uri);
    }

    void (async () => {
      try {
        const folder = new Directory(Paths.cache, FOLDER);

        if (!folder.exists) {
          folder.create({ intermediates: true });
        }

        const file = new File(folder, keyFor(cacheKey ?? target.uri));

        if (file.exists) {
          if (alive) setSource(file.uri);
          return;
        }

        const saved = await File.downloadFileAsync(target.uri, file, {
          ...(target.headers ? { headers: target.headers } : {}),
          idempotent: true,
        });

        if (alive) setSource(saved.uri);
      } catch {
        /*
         * Left as the placeholder. A retry button on every tile would be
         * noise, and the thread reloads whenever the screen is reopened.
         */
        if (alive) {
          setSource(null);
          setFailed(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [uri, cacheKey]);

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
      onError={() => setFailed(true)}
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
