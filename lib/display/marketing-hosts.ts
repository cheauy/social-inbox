/*
 * The hostnames that serve the marketing page instead of the app.
 *
 * Shared rather than repeated: app/page.tsx decides what to render by this
 * list, and the session-check endpoint decides who may ask it whether the
 * caller is signed in. If those two ever disagreed, the marketing site would
 * render but its check would be refused, and a signed-in visitor would sit on
 * the marketing page forever with no sign anything was wrong.
 *
 * Both are listed because the bare domain 308s to www in Vercel, so the page
 * actually runs on www while links and typed addresses arrive at the apex.
 *
 * market.tenhchat.com was here until the domain itself was retired; it now
 * answers 404 at the edge and never reaches this code, so listing it only
 * described a host that no longer exists.
 */
export const MARKETING_HOSTS = new Set([
  "tenhchat.com",
  "www.tenhchat.com",
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
