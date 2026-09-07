import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MarketingPage } from "@/components/marketing/marketing-page";
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
 * market.tenhchat.com is being retired in favour of tenhchat.com, but it stays
 * listed until the domain itself is removed or redirected in Vercel. Dropping
 * it here first would not retire it -- it would just start serving the app to
 * anyone still holding that link, which is worse than leaving it.
 */
const MARKETING_HOSTS = new Set([
  "tenhchat.com",
  "www.tenhchat.com",
  "market.tenhchat.com",
]);

function normalizeHost(value: string | null) {
  if (!value) {
    return "";
  }

  // Host can arrive as "name:port"; the port is never part of the match.
  return value.trim().toLowerCase().split(":")[0];
}

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
