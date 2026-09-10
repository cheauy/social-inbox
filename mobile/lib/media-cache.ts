import { Directory, File, Paths } from "expo-file-system";

/*
 * One copy of a picture on disk, keyed by something stable.
 *
 * Written for quick replies, where the same photo was downloaded again on
 * every open: the server mints a fresh signed link each time, so React
 * Native's cache -- which keys on the URL -- never recognised a file it had
 * already fetched. These are not small pictures either. A saved reply's size
 * chart in this workspace is a 2.6 MB PNG, drawn into a 52-point square.
 *
 * So: fetch once per file per install, under a key the caller chooses -- a
 * storage path, an attachment id -- and read from disk ever after.
 */

const FOLDER = "tenh-media";

/* A file name that is stable for a key and safe on disk. */
export function cacheNameFor(key: string) {
  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(index)) | 0;
  }

  return "m" + (hash >>> 0).toString(36);
}

export function cachedFile(key: string) {
  return new File(new Directory(Paths.cache, FOLDER), cacheNameFor(key));
}

/**
 * The local copy, downloading it first if this device has not got it yet.
 * Returns null when it cannot be had, so a caller can fall back to the link.
 */
export async function cacheMedia(
  uri: string,
  key: string,
  headers?: Record<string, string>,
): Promise<string | null> {
  try {
    const folder = new Directory(Paths.cache, FOLDER);

    if (!folder.exists) {
      folder.create({ intermediates: true });
    }

    const file = new File(folder, cacheNameFor(key));

    if (file.exists) {
      return file.uri;
    }

    const saved = await File.downloadFileAsync(uri, file, {
      ...(headers ? { headers } : {}),
      idempotent: true,
    });

    return saved.uri;
  } catch {
    return null;
  }
}

/**
 * Start fetching pictures somebody is about to look at.
 *
 * Quick replies are opened mid-conversation, with a customer waiting, and the
 * pictures are the point of them -- the size chart, the price list. Fetching
 * them when the list arrives rather than when the sheet opens means the sheet
 * has something to draw the first time it is opened, not the second.
 *
 * Anything already on disk costs nothing, and a failure is silent: this is a
 * head start, not a requirement.
 */
export async function warmMedia(
  items: { uri: string; key: string; headers?: Record<string, string> }[],
) {
  for (const item of items) {
    if (cachedFile(item.key).exists) continue;

    await cacheMedia(item.uri, item.key, item.headers);
  }
}
