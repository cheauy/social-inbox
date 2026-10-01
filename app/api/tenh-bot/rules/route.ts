import { TENH_BOT_AVAILABLE } from "@/lib/bot/availability";
import { tenhBotComingSoonResponse } from "@/lib/bot/coming-soon-response";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { parseDraftRules } from "@/lib/bot/draft-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const reply = (data: object, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
async function channel(business: string, id: string) {
  return db.from("social_accounts").select("id,platform").eq("business_id", business).eq("id", id).eq("is_active", true).maybeSingle();
}
export async function GET(request: NextRequest) {
  if(!TENH_BOT_AVAILABLE)return tenhBotComingSoonResponse();
  const guard = await requirePermission("channels", "view");
  if (!guard.success) return guard.response;
  const business = guard.context.member.business_id, id = request.nextUrl.searchParams.get("channelId");
  if (!uuid(id)) return reply({ error: "Choose a connected channel." }, 400);
  const page = await channel(business, id);
  if (page.error) return reply({ error: "Channel lookup unavailable." }, 503);
  if (!page.data) return reply({ error: "Channel not found." }, 404);
  const saved = await db.from("tenh_bot_rule_sets").select("rules,revision,updated_at").eq("business_id", business).eq("social_account_id", id).maybeSingle();
  if (saved.error) return reply({ error: "Durable Bot storage is not installed or is unavailable.", storageAvailable: false }, 503);
  return reply({ success: true, rules: saved.data?.rules ?? [], revision: saved.data?.revision ?? 0,
    updatedAt: saved.data?.updated_at ?? null, enabled: false, executionAvailable: false });
}
export async function POST(request: NextRequest) {
  if(!TENH_BOT_AVAILABLE)return tenhBotComingSoonResponse();
  const guard = await requirePermission("channels", "manage");
  if (!guard.success) return guard.response;
  const business = guard.context.member.business_id;
  try {
    if (Number(request.headers.get("content-length")) > 262144) return reply({ error: "Bot configuration is too large." }, 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 262144) return reply({ error: "Bot configuration is too large." }, 413);
    const body = JSON.parse(raw);
    if (!body || !uuid(body.channelId) || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
        body.enabled !== undefined && body.enabled !== false || !Array.isArray(body.rules)) return reply({ error: "Invalid disabled Bot configuration." }, 400);
    const page = await channel(business, body.channelId);
    if (page.error) return reply({ error: "Channel lookup unavailable." }, 503);
    if (!page.data) return reply({ error: "Channel not found." }, 404);
    if (page.data.platform !== "facebook") return reply({ error: "These Bot configurations support Facebook only." }, 422);
    const rules = body.rules.length ? parseDraftRules(body.rules, { businessId: business, channelId: body.channelId }) : [];
    const memberIds = [...new Set(rules.flatMap(rule => rule.memberIds))];
    if (memberIds.length) {
      const teamGuard = await requirePermission("team_members", "view");
      if (!teamGuard.success) return teamGuard.response;
      const members = await db.from("team_members").select("id").eq("business_id", business).eq("is_active", true).in("id", memberIds);
      if (members.error) return reply({ error: "Staff lookup unavailable." }, 503);
      if (memberIds.some(id => !(members.data ?? []).some(member => member.id === id))) return reply({ error: "Choose active staff from this workspace." }, 400);
    }
    const result = await db.rpc("tenh_bot_save_rule_set", { p_business: business, p_channel: body.channelId,
      p_revision: body.revision, p_rules: rules });
    if (result.error) return reply({ error: "Durable Bot storage is not installed or is unavailable." }, 503);
    if (!result.data?.saved) return reply({ error: "Saved configuration changed. Reload before saving.", conflict: true }, 409);
    return reply({ success: true, revision: result.data.revision, enabled: false, executionAvailable: false });
  } catch {
    return reply({ error: "Invalid Bot configuration. Check its rules and workspace." }, 400);
  }
}
