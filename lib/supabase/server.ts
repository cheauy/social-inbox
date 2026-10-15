import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AuthError } from "@supabase/supabase-js";
import { checkSessionPolicy } from "@/lib/auth/session-policy";
import { verifyAuthTicket } from "@/lib/auth/auth-ticket";
import { SESSION_HINT_COOKIE, isProjectAuthCookie, readSessionCookieHint, sessionCookiePersistence } from "@/lib/auth/session-cookie-options";
import { isTerminalAuthSessionError } from "@/lib/auth/session-errors";

export async function createClient(flow: { authFlow?: boolean; allowRecovery?: boolean } = {}) {
  const cookieStore = await cookies();

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

  const privateNames = new Set([SESSION_HINT_COOKIE, "tenh_auth_intent", "tenh_recovery_grant", "tenh_active_business_id"]);
  const ownCookie = (name: string) => privateNames.has(name) || isProjectAuthCookie(name, supabaseUrl);
  const snapshot = () => new Map(cookieStore.getAll().filter(cookie => ownCookie(cookie.name)).map(cookie => [cookie.name, cookie.value]));
  let expectedCookies = snapshot();
  let pendingCookieWrites: Array<() => void> | null = null;
  const replaced = (before: Map<string, string>) => [...snapshot()].some(([name, value]) => value && before.get(name) !== value);
  const client = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          const guarded = pendingCookieWrites !== null;
          const apply = () => {
            try {
              // An older in-flight request must not overwrite a newer session in this cookie store.
              if (guarded && replaced(expectedCookies)) return;
              cookiesToSet.forEach(
                ({
                  name,
                  value,
                  options,
                }) => {
                  cookieStore.set(
                    name,
                    value,
                  options.maxAge === 0 ? options : (() => {
                    const cleanOptions = { ...options };
                    const signed = cookieStore.get(SESSION_HINT_COOKIE)?.value;
                    // Preserve legacy persistence during the reviewed reauthentication window.
                    if (!signed) return cleanOptions;
                    delete cleanOptions.maxAge;
                    delete cleanOptions.expires;
                    const hint = verifyAuthTicket(signed, "persistence") ? readSessionCookieHint(signed) : null;
                    return { ...cleanOptions, ...sessionCookiePersistence(hint) };
                  })(),
                  );
                },
              );
              expectedCookies = snapshot();
            } catch {
              /*
               * Server Components cannot always
               * modify cookies directly.
               */
            }
          };
          if (pendingCookieWrites) pendingCookieWrites.push(apply);
          else apply();
        },
      },
    },
  );
  const getUser = client.auth.getUser.bind(client.auth);
  let userLookup: ReturnType<typeof getUser> | null = null;
  let unavailableUser: Awaited<ReturnType<typeof getUser>> | null = null;
  async function lookupUser(jwt?: string) {
    const before = snapshot();
    const writes: Array<() => void> = [];
    if (!jwt) { expectedCookies = before; pendingCookieWrites = writes; }
    let result: Awaited<ReturnType<typeof getUser>>;
    try { result = await getUser(jwt); }
    finally { if (!jwt) pendingCookieWrites = null; }
    // Keep an SDK-local removal after an outage from becoming a false terminal error later in this request.
    if (!jwt && result.error && !isTerminalAuthSessionError(result.error)) unavailableUser = result;
    // The SDK can schedule removals before returning an error. Keep cookies on outages.
    if (!jwt && (!result.error || isTerminalAuthSessionError(result.error))) for (const write of writes) write();
    if (!jwt && isTerminalAuthSessionError(result.error) && !replaced(before)) {
      try {
        for (const name of new Set([...before.keys(), ...snapshot().keys()])) cookieStore.set(name, "", {
          path: "/", maxAge: 0, sameSite: "lax", secure: process.env.NODE_ENV === "production",
        });
        expectedCookies = snapshot();
      } catch { /* Proxy and the browser boundary own cleanup when Server Components cannot write cookies. */ }
    }
    if (flow.authFlow || result.error || !result.data.user) return result;
    const policy = await checkSessionPolicy(client, result.data.user, { allowRecovery: flow.allowRecovery });
    if (!policy.allowed) return { data: { user: null }, error: new AuthError(
      policy.reason === "expired" ? "Your session expired. Please sign in again." : "Sign in again to continue.",
      policy.status, policy.reason === "expired" ? "SESSION_EXPIRED" : "SESSION_POLICY_DENIED",
    ) };
    return result;
  }
  client.auth.getUser = (jwt?: string) => {
    if (jwt) return lookupUser(jwt);
    if (unavailableUser) return Promise.resolve(unavailableUser);
    userLookup ??= lookupUser().finally(() => { userLookup = null; });
    return userLookup;
  };
  return client;
}
