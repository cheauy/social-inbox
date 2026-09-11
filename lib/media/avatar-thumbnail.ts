import "server-only";
import sharp from "sharp";

export async function avatarThumbnail(input: Buffer) {
  // Decode limits prevent a tiny compressed image from allocating huge memory.
  return sharp(input, { limitInputPixels: 25_000_000, animated: false })
    .rotate()
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}
