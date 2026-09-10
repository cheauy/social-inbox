import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/*
 * A photo small enough to actually send.
 *
 * The server sits behind a request-body limit -- 4.5 MB on this deployment --
 * and it counts the whole multipart request, not one part of it. A quick
 * reply carrying two 2.6 MB PNGs is 5.2 MB before the boundaries are added,
 * which is why sending one came back "Request Entity Too Large" and took the
 * text with it. A phone camera photo is often bigger still.
 *
 * Nobody is served by sending the original: Messenger and Telegram both
 * re-encode what they receive, and the customer is looking at it on a phone.
 * So anything over the threshold is resized to fit inside 1600 points and
 * saved as JPEG, which turns a 2.6 MB screenshot into something like 300 KB
 * and leaves a photo of a product perfectly readable.
 *
 * Anything already small enough is left exactly as it is -- an untouched file
 * is one fewer thing to be wrong about, and re-encoding a small picture only
 * loses detail.
 */

/* Below this, sending the original costs nothing worth saving. */
const KEEP_UNDER_BYTES = 900_000;

/* Long edge, in pixels. Above this nothing is gained on a phone screen. */
const LONGEST_EDGE = 1600;

const QUALITY = 0.82;

export function fileSize(uri: string) {
  try {
    const file = new File(uri);

    return file.exists ? (file.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/**
 * The picture to send: the original when it is small, a resized copy when it
 * is not. Never throws -- a manipulator that cannot read a file gives back
 * the file, and the send fails or succeeds on its own merits.
 */
export async function shrinkImage(uri: string): Promise<{
  uri: string;
  mimeType: string;
  shrank: boolean;
}> {
  const original = fileSize(uri);

  if (original > 0 && original <= KEEP_UNDER_BYTES) {
    return { uri, mimeType: "", shrank: false };
  }

  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: LONGEST_EDGE });

    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      compress: QUALITY,
      format: SaveFormat.JPEG,
    });

    /* A "smaller" copy that is bigger is not an improvement. */
    if (original > 0 && fileSize(saved.uri) >= original) {
      return { uri, mimeType: "", shrank: false };
    }

    return { uri: saved.uri, mimeType: "image/jpeg", shrank: true };
  } catch {
    return { uri, mimeType: "", shrank: false };
  }
}
