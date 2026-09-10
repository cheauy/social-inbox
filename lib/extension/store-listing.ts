/*
 * Where a customer gets TENH v1.
 *
 * One place, because the answer changes exactly once: today the listing is not
 * published, and the day it is, this becomes a Chrome Web Store link and every
 * screen that mentions the extension starts pointing at it.
 *
 * Set NEXT_PUBLIC_TENH_EXTENSION_STORE_URL in Vercel to the listing URL and
 * redeploy. Until then the pages say it is on the way, which is true, rather
 * than teaching customers to load an unpacked folder -- that is a developer's
 * step and it is in tenh-extension/README.md, where a developer will look.
 */

const configured =
  process.env.NEXT_PUBLIC_TENH_EXTENSION_STORE_URL?.trim() ?? "";

/** The listing, or null while it is still in review. */
export const TENH_EXTENSION_STORE_URL = configured.startsWith(
  "https://chromewebstore.google.com/",
)
  ? configured
  : null;
