import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { MarketingPage } from "@/components/marketing/marketing-page";
import { createClient } from "@/lib/supabase/server";

/*
 * One deployment serves both the app hostname and the marketing hostname,
 * so the root route decides by Host which one the visitor asked for.
 *
 * Temporary arrangement: marketing lives on market.tenhchat.com while the
 * app is still in review on the main domain. When it moves to tenhchat.com,
 * add that host here; when market.tenhchat.com is retired, drop it. Nothing
 * else needs to change.
 */
const MARKETING_HOSTS = new Set([
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
