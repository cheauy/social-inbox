import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { decodeFacebookOAuthSession, FACEBOOK_OAUTH_SESSION_COOKIE } from "@/lib/facebook/facebook-oauth-session";
import { getFacebookAuthorizedPages } from "@/lib/facebook/facebook-authorized-pages";
import { supabaseAdmin } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
function bridge(payload: unknown) {
  const nonce = randomBytes(16).toString("base64");
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return new NextResponse(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script nonce="${nonce}">
    window.ReactNativeWebView.postMessage(JSON.stringify(${json}));
    window.connectSelectedPages = function(ids) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(id => typeof id === 'string' && /^[0-9]+$/.test(id))) return;
      const form = document.createElement('form'); form.method = 'POST'; form.action = '/api/facebook/oauth/select';
      ids.forEach(id => { const field = document.createElement('input'); field.type='hidden'; field.name='pageId'; field.value=id; form.appendChild(field); });
      document.body.appendChild(form); form.submit();
    };
  </script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, "X-Content-Type-Options": "nosniff" } });
}
export async function GET() {
  const auth = await getCurrentMember();
  if (!auth.success) return bridge({ type: "error", message: "Please sign in to the app again." });
  if (!(await memberHasPermission(auth.member, "channels", "manage"))) return bridge({ type: "error", message: "You do not have permission to connect channels." });
  try {
    const value = (await cookies()).get(FACEBOOK_OAUTH_SESSION_COOKIE)?.value;
    if (!value) return bridge({ type: "error", message: "Facebook authorization expired. Please try again." });
    const session = decodeFacebookOAuthSession(value);
    if (session.businessId !== auth.member.business_id || session.memberId !== auth.member.id) return bridge({ type: "error", message: "This connection belongs to a different workspace." });
    const { pages } = await getFacebookAuthorizedPages(session.userAccessToken);
    const { data, error } = await supabaseAdmin.from("social_accounts").select("platform_account_id,is_active,facebook_token_status").eq("business_id", auth.member.business_id).eq("platform", "facebook");
    if (error) throw new Error("Unable to check connections");
    const connected = new Set((data ?? []).filter(row => row.is_active && row.facebook_token_status === "connected").map(row => row.platform_account_id));
    // Explicit allowlist: access tokens and other Meta data never reach native UI.
    return bridge({ type: "pages", pages: pages.slice(0, 100).map(page => ({ id: page.id, name: page.name || "Facebook Page", connected: connected.has(page.id) })) });
  } catch { return bridge({ type: "error", message: "Unable to load Facebook Pages. Please retry Facebook authorization." }); }
}
