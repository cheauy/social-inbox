/*
 * No imports on purpose.
 *
 * This is the workspace boundary for stored quick reply media, and the repo
 * keeps rules like this in their own dependency-free module so a test can load
 * them directly -- saved-reply-attachments.ts pulls in "server-only" and cannot
 * be imported by the test runner. A boundary nobody can test is a boundary
 * nobody can change safely.
 */
export const SAVED_REPLY_MEDIA_PREFIX =
  "saved-replies";

/*
 * The workspace boundary for stored quick reply media.
 *
 * This is the only thing standing between a caller and a signed URL for
 * another workspace's file, so it refuses anything it has not been asked to
 * reason about rather than trusting the prefix alone.
 *
 * A bare startsWith accepts "saved-replies/<mine>/../<theirs>/file.jpg",
 * which reads as another workspace's path. Supabase Storage treats an object
 * key as an opaque string and never resolves "..", so that key simply does
 * not exist and no file comes back -- but that is a property of the storage
 * backend, not of this check, and a tenant boundary should not rest on
 * somebody else's implementation detail. The segment test makes the guarantee
 * local.
 */
export function isPathOwnedByBusiness(
  path: string,
  businessId: string,
) {
  if (!path || !businessId) {
    return false;
  }

  const prefix = `${SAVED_REPLY_MEDIA_PREFIX}/${businessId}/`;

  if (!path.startsWith(prefix)) {
    return false;
  }

  // No traversal, no empty segments, no backslashes standing in for a
  // separator -- every remaining segment must be an ordinary file name.
  const rest = path.slice(prefix.length);

  if (!rest || rest.includes("\\")) {
    return false;
  }

  return rest
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== "..",
    );
}
