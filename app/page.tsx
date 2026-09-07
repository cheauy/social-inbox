import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MarketingPage } from "@/components/marketing/marketing-page";
import {
  MARKETING_HOSTS,
  normalizeHost,
} from "@/lib/display/marketing-hosts";
import { createClient } from "@/lib/supabase/server";

/*
 * One deployment serves both the app hostname and the marketing hostname,
 * so the root route decides by Host which one the visitor asked for.
 *
 * The app now lives on app.tenhchat.com, so the bare domain and www belong to
 * marketing. Only the root route moves: every other path is shared, which is
 * what lets www keep answering the Facebook OAuth callback while its front
 * page becomes the marketing site.
 *
 * The host list and the matching live in lib/display/marketing-hosts, because
 * the session-check endpoint has to agree with them exactly.
 */

export default async function HomePage() {
  const headerList = await headers();

  /*
   * Vercel puts the hostname the visitor actually typed in x-forwarded-host
   * when a proxy rewrites Host, so prefer it and fall back to Host.
   */
  const host =
    normalizeHost(headerList.get("x-forwarded-host")) ||
    normalizeHost(headerList.get("host"));

  if (MARKETING_HOSTS.has(host)) {
    return <MarketingPage />;
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard/inbox");
  }

  redirect("/login");
}
