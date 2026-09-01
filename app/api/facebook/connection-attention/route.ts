import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

type AttentionAccount = {
  id: string;
  account_name: string | null;
  facebook_token_status: string | null;
  facebook_token_last_error: string | null;
};

function requiresReauthorization(status: string | null) {
  const normalized = status?.trim().toLowerCase() ?? "";
  return ["expired", "invalid", "revoked"].some((value) =>
    normalized.includes(value),
  );
}

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status, headers: NO_STORE_HEADERS },
    );
  }

  const currentMember = authResult.member;
  const canManageChannels = await memberHasPermission(
    currentMember,
    "channels",
    "manage",
  );

  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      account_name,
      facebook_token_status,
      facebook_token_last_error
    `)
    .eq("business_id", currentMember.business_id)
    .eq("platform", "facebook")
    .eq("is_active", true)
    .returns<AttentionAccount[]>();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to check Facebook connection status.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const pages = (data ?? [])
    .filter((account) => requiresReauthorization(account.facebook_token_status))
    .map((account) => ({
      id: account.id,
      name: account.account_name?.trim() || "Facebook Page",
      status: account.facebook_token_status?.trim() || "invalid",
      message: account.facebook_token_last_error?.trim() || null,
    }));

  return NextResponse.json(
    {
      success: true,
      canManageChannels,
      pages,
    },
    { headers: NO_STORE_HEADERS },
  );
}
