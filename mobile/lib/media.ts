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

export type MediaSource = { uri: string; headers?: Record<string, string> };

const isOurs = (uri: string) => uri.startsWith("/") || uri.startsWith(BASE);

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

    if (!isOurs(uri)) {
      return { uri };
    }

    const absolute = uri.startsWith("/") ? new URL(uri, BASE).toString() : uri;

    return cookie
      ? { uri: absolute, headers: { Cookie: cookie } }
      : { uri: absolute };
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
