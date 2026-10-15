import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AuthError } from "@supabase/supabase-js";
import { checkSessionPolicy } from "@/lib/auth/session-policy";
import { verifyAuthTicket } from "@/lib/auth/auth-ticket";
import { SESSION_HINT_COOKIE, readSessionCookieHint, sessionCookiePersistence } from "@/lib/auth/session-cookie-options";

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

  const client = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },

        setAll(cookiesToSet) {
          try {
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
          } catch {
            /*
             * Server Components cannot always
             * modify cookies directly.
             */
          }
        },
      },
    },
  );
  if (!flow.authFlow) {
    const getUser = client.auth.getUser.bind(client.auth);
    client.auth.getUser = async (jwt?: string) => {
      const result = await getUser(jwt);
      if (result.error || !result.data.user) return result;
      const policy = await checkSessionPolicy(client, result.data.user, { allowRecovery: flow.allowRecovery });
      if (!policy.allowed) return { data: { user: null }, error: new AuthError(
        policy.reason === "expired" ? "Your session expired. Please sign in again." : "Sign in again to continue.",
        policy.status, policy.reason === "expired" ? "SESSION_EXPIRED" : "SESSION_POLICY_DENIED",
      ) };
      return result;
    };
  }
  return client;
}
