import { inboxImageEndpoint, type ReplyImageReference } from "./message-actions";

/** Prefer items OR files, never both: browsers expose the same pasted image twice. */
export function clipboardImageFiles(data: Pick<DataTransfer, "items" | "files">): File[] {
  const items = Array.from(data.items ?? []).flatMap(item => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file?.type.startsWith("image/") ? [file] : [];
  });
  return items.length ? items : Array.from(data.files ?? []).filter(file => file.type.startsWith("image/"));
}

async function imageAsPng(blob: Blob): Promise<Blob> {
  if (blob.size > 20 * 1024 * 1024) throw new Error("This image is too large to copy. Save the image instead.");
  if (blob.type === "image/png") return blob;
  if (!blob.type.startsWith("image/")) throw new Error("The photo is unavailable.");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error("This image is too large to copy. Save the image instead.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image copying is unavailable in this browser.");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error("Unable to prepare this image.")), "image/png",
    ));
  } finally { URL.revokeObjectURL(objectUrl); }
}

async function loadClipboardPng(src: string, reference?: ReplyImageReference): Promise<Blob> {
  // Local/accessible images need no server work. Provider CDNs may block CORS;
  // the fallback accepts a message reference, never an arbitrary remote URL.
  try {
    const response = await fetch(src, { credentials: "same-origin", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("Image download failed.");
    return await imageAsPng(await response.blob());
  } catch {
    if (!reference?.messageId && !reference?.platformMessageId) throw new Error("Open the photo and use your browser's Copy image option.");
    const response = await fetch(inboxImageEndpoint(reference), { credentials: "same-origin", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("This photo cannot be copied. Open it and use Copy image, or save it first.");
    return await imageAsPng(await response.blob());
  }
}

/** Start write during the click/keyboard gesture; Safari loses activation after await. */
export async function copyInboxImage(src: string, reference?: ReplyImageReference): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Image copying needs a supported browser on HTTPS or localhost. Open the photo and use Copy image.");
  }
  const png = loadClipboardPng(src, reference);
  // Consume a later rejection even if the browser refuses the clipboard write immediately.
  void png.catch(() => {});
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
