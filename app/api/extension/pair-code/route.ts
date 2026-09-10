import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  PAIR_CODE_TTL_MS,
  generatePairCode,
  hashSecret,
  recordExtensionEvent,
} from "@/lib/extension/device-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * A code the browser can exchange for a device token, and nothing else.
 *
 * Issued to a signed-in member of this workspace, good for five minutes and
 * for one use. The extension never sees a TENH session: this is the only thing
 * that crosses from the page into it, and by the time anybody could copy it
 * out of a screenshot it has expired.
 */
export async function POST() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const member = authResult.member;

  /* Any earlier code from this person is void the moment a new one is asked
     for -- two live codes is one more than anybody needs. */
  await supabaseAdmin
    .from("extension_pair_codes")
    .delete()
    .eq("member_id", member.id)
    .is("used_at", null);

  const code = generatePairCode();
  const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS);

  const { error } = await supabaseAdmin.from("extension_pair_codes").insert({
    business_id: member.business_id,
    member_id: member.id,
    user_id: member.user_id,
    code_hash: hashSecret(code),
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    return NextResponse.json(
      { success: false, error: "Unable to start pairing. Please try again." },
      { status: 500 },
    );
  }

  void recordExtensionEvent({
    businessId: member.business_id,
    memberId: member.id,
    userId: member.user_id,
    eventType: "pair_code_issued",
    status: "ok",
  });

  return NextResponse.json({
    success: true,
    code,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: Math.round(PAIR_CODE_TTL_MS / 1000),
  });
}
