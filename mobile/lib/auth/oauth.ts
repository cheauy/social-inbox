import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { supabase } from "../supabase/client";

/*
 * Signing in with Google or Facebook, from a phone.
 *
 * On the web Supabase redirects the tab and reads the session back out of the
 * URL. There is no tab here, so the three steps are done by hand: ask Supabase
 * for the provider's URL without letting it navigate anywhere, open that URL
 * in the system's own auth browser -- Chrome Custom Tabs on Android, which
 * keeps the address bar visible so somebody can see they are typing their
 * Google password into Google -- and exchange the code it hands back.
 *
 * The code exchange is what makes this a PKCE flow: the verifier stays in the
 * app's encrypted storage and never travels, so a link that leaks in a log
 * cannot be replayed into a session.
 */

export type OAuthProvider = "google" | "facebook";

/* Matches the scheme declared in app.json. */
const redirectTo = Linking.createURL("auth/callback");

export async function signInWithProvider(provider: OAuthProvider) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: provider === "facebook" ? "email,public_profile" : undefined,
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error("Could not start sign-in. Please try again.");

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  /*
   * Dismissing the browser is not a failure -- somebody changed their mind --
   * so it returns quietly and the form stays as it was.
   */
  if (result.type !== "success") return false;

  const returned = new URL(result.url);
  const code = returned.searchParams.get("code");

  if (!code) {
    const message =
      returned.searchParams.get("error_description") ||
      returned.searchParams.get("error");

    throw new Error(message || "Sign-in was not completed.");
  }

  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) throw exchangeError;

  return true;
}
