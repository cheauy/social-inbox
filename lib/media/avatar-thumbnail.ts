import "server-only";
import sharp from "sharp";

export type AvatarFormat = "webp" | "jpeg";

export async function avatarThumbnail(input: Buffer, format: AvatarFormat = "webp") {
  // Decode limits prevent a tiny compressed image from allocating huge memory.
  const thumbnail = sharp(input, { limitInputPixels: 25_000_000, animated: false })
    .rotate()
    .resize(256, 256, { fit: "inside", withoutEnlargement: true });
  return format === "jpeg"
    ? thumbnail.flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toBuffer()
    : thumbnail.webp({ quality: 80 }).toBuffer();
}
