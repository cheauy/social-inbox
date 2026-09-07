/*
 * The hostnames that serve the marketing page instead of the app.
 *
 * Shared rather than repeated: app/page.tsx decides what to render by this
 * list, and the session-check endpoint decides who may ask it whether the
 * caller is signed in. If those two ever disagreed, the marketing site would
 * render but its check would be refused, and a signed-in visitor would sit on
 * the marketing page forever with no sign anything was wrong.
 *
 * market.tenhchat.com is retired in favour of tenhchat.com but stays listed
 * until the domain itself is removed or redirected in Vercel. Dropping it here
 * would not retire it -- it would start serving the app to anyone still
 * holding that link.
 */
export const MARKETING_HOSTS = new Set([
  "tenhchat.com",
  "www.tenhchat.com",
  "market.tenhchat.com",
]);

export function normalizeHost(value: string | null) {
  if (!value) {
    return "";
  }

  // Host can arrive as "name:port"; the port is never part of the match.
  return value.trim().toLowerCase().split(":")[0];
}

/*
 * An Origin header is a scheme and host, and only https is ever allowed to
 * carry a session -- a plain-http origin claiming to be tenhchat.com is either
 * a downgrade or a local experiment, and neither should be handed an answer
 * about somebody's login.
 */
export function isMarketingOrigin(origin: string | null) {
  if (!origin) {
    return false;
  }

  try {
    const url = new URL(origin);

    return (
      url.protocol === "https:" &&
      MARKETING_HOSTS.has(
        normalizeHost(url.hostname),
      )
    );
  } catch {
    return false;
  }
}
