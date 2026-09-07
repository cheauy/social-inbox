/*
 * Where the app lives, as seen from the marketing site.
 *
 * The two are one deployment on different hostnames: tenhchat.com serves the
 * marketing page, app.tenhchat.com serves the product. Every path other than
 * `/` is shared, so a relative "/register" on the marketing site resolves to
 * tenhchat.com/register -- the real sign-up form, but on the marketing domain.
 * It works, and that is the problem: the visitor never crosses to the app, so
 * the address bar disagrees with what Meta, the session cookie and every later
 * link expect.
 *
 * Empty in development on purpose. A hardcoded https://app.tenhchat.com in a
 * local build would send anyone testing sign-up straight to production, which
 * is a far worse failure than a wrong-looking hostname. An empty origin leaves
 * the links relative, so localhost keeps talking to localhost.
 *
 * Resolved at build time, not from window.location, so the server and the
 * client render the same href and hydration stays quiet.
 */
export const APP_ORIGIN =
  process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() ||
  (process.env.NODE_ENV === "production"
    ? "https://app.tenhchat.com"
    : "");

/*
 * Only ever called with a literal path from our own markup -- there is no user
 * input anywhere near it, so there is nothing here that could redirect a
 * visitor somewhere we did not write down.
 */
export function appUrl(path: string) {
  return `${APP_ORIGIN}${path}`;
}
