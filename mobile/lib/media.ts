import { authCookieName, supabase } from "./supabase/client";
import { sessionCookie } from "./api/session-cookie";
import { useAuth } from "./auth/provider";
import { useInbox } from "./inbox-provider";

/*
 * Turning a stored attachment into something React Native can actually fetch.
 *
 * Facebook writes absolute CDN links that need no credentials, so the phone
 * has always been able to draw them. Telegram cannot: a Telegram file URL
 * carries the bot token and expires, so TENH stores a path of its own --
 * "/api/messages/<id>/media" -- and proxies the bytes. On the web that is a
 * same-origin request the browser signs with its cookie, and it just works.
 *
 * On the phone it was neither: no origin to resolve the path against, and no
 * cookie to authenticate with. Every Telegram photo, sticker and voice note
 * rendered as an empty black square, silently, because a failed <Image/> has
 * nothing to say.
 *
 * Both halves are fixed here: relative paths get the API origin, and anything
 * pointed at TENH gets the same session cookie api() sends. Absolute links
 * elsewhere are handed back untouched -- signing a request to Facebook's CDN
 * with our cookie would leak it to Meta.
 */

const BASE = process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com";

export type MediaSource = { uri: string; headers?: Record<string, string>; cacheScope?: string };

const STORAGE = process.env.EXPO_PUBLIC_SUPABASE_URL || "";

/*
 * Ours means TENH's own API, and nothing else.
 *
 * Any leading slash used to count, which swept up Supabase's signed storage
 * links: those are minted against the storage host, and resolving one against
 * the API origin produced a URL that answers 404 -- so a quick reply's photo
 * sat on its placeholder for ever, with our session cookie attached to a
 * request that was never going to work.
 */
const isOurs = (uri: string) => {
  if (uri.startsWith("/") && !uri.startsWith("/api/")) return false;
  try { return new URL(uri, BASE).origin === new URL(BASE).origin; } catch { return false; }
};

/*
 * The session, kept as a plain string beside the provider.
 *
 * <Image/> takes headers synchronously and there is no awaiting it mid-render,
 * so the cookie is built once per session change rather than per picture.
 */
export function useMediaSource() {
  const { session } = useAuth();
  const { workspace } = useInbox();

  const cookie = session
    ? sessionCookie(authCookieName, session, workspace?.businessId)
    : null;

  return (uri: string | null | undefined): MediaSource | null => {
    if (!uri) return null;
    const cacheScope = session?.user.id && workspace?.businessId ? `${session.user.id}:${workspace.businessId}` : undefined;

    if (!isOurs(uri)) {
      /* A relative link from Supabase storage belongs to the storage host. */
      return {
        cacheScope,
        uri:
          uri.startsWith("/") && STORAGE
            ? new URL(uri, STORAGE).toString()
            : uri,
      };
    }

    const absolute = uri.startsWith("/") ? new URL(uri, BASE).toString() : uri;

    return cookie
      ? { uri: absolute, headers: { Cookie: cookie }, cacheScope }
      : { uri: absolute, cacheScope };
  };
}

/*
 * The same resolution for code that is not a component -- downloading a file
 * to share it, for instance, where the session is fetched rather than hooked.
 */
export async function mediaSource(
  uri: string,
  workspaceId?: string | null,
): Promise<MediaSource> {
  if (!isOurs(uri)) return { uri };

  const absolute = uri.startsWith("/") ? new URL(uri, BASE).toString() : uri;
  const { data } = await supabase.auth.getSession();

  return data.session
    ? {
        uri: absolute,
        headers: {
          Cookie: sessionCookie(authCookieName, data.session, workspaceId),
        },
      }
    : { uri: absolute };
}
