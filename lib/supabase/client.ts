"use client";

import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { SESSION_HINT_COOKIE, readSessionCookieHint, sessionCookiePersistence } from "@/lib/auth/session-cookie-options";

export function createClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL.",
    );
  }

  if (!supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createBrowserClient(
    supabaseUrl,
    supabaseAnonKey,
    { cookies: {
      getAll: () => typeof document === "undefined" ? [] : parseCookieHeader(document.cookie).map(cookie => ({ name: cookie.name, value: cookie.value ?? "" })),
      setAll: cookies => {
        if (typeof document === "undefined") return;
        const value = parseCookieHeader(document.cookie).find(cookie => cookie.name === SESSION_HINT_COOKIE)?.value;
        const hint = readSessionCookieHint(value);
        for (const cookie of cookies) {
          const options = { ...cookie.options };
          if (options.maxAge !== 0 && value) {
            delete options.maxAge;
            delete options.expires;
            Object.assign(options, sessionCookiePersistence(hint));
          }
          document.cookie = serializeCookieHeader(cookie.name, cookie.value, options);
        }
      },
    } },
  );
}
