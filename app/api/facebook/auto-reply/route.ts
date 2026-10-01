import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { resolveStoredFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { autoReplyGraph, inspectAutoReply, type AutoReplyJob } from "@/lib/facebook/auto-reply";
import { parseDraftRules, parseDraftEvents, previewDraftRules } from "@/lib/bot/draft-rules";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (data: object, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function GET(request: NextRequest) {
  const guard = await requirePermission("channels", "view");
  if (!guard.success) return guard.response;
  const business = guard.context.member.business_id;
  if (request.nextUrl.searchParams.get("scope") === "drafts") {
    const teamGuard = await requirePermission("team_members", "view");
    const [pages, members] = await Promise.all([
      db.from("social_accounts").select("id,account_name,platform").eq("business_id", business).eq("is_active",true).limit(100),
      teamGuard.success ? db.from("team_members").select("id,full_name").eq("business_id",business).eq("is_active",true).limit(100) : Promise.resolve({data:[],error:null}),
    ]);
    if (pages.error || members.error) return reply({error:"Draft context unavailable."},503);
    return reply({businessId:business,pages:pages.data,members:members.data,canManage:guard.context.permissions.channels === "manage" || guard.context.isOwner,
      executionAvailable:false,note:"Draft tests only. Live channel execution unavailable."});
  }
  const before = request.nextUrl.searchParams.get("before");
  let history = db.from("facebook_auto_reply_jobs").select("id,rule_id,comment_id,action,status,reason,attempts,platform_reply_id,created_at")
    .eq("business_id", business).order("created_at", { ascending: false }).limit(50);
  if (before) {
    if (!Number.isFinite(Date.parse(before))) return reply({ error: "Invalid history cursor." }, 400);
    history = history.lt("created_at", before);
  }
  const [rules, pages, jobs, control] = await Promise.all([
    db.from("facebook_auto_reply_rules").select("*").eq("business_id", business).order("created_at", { ascending: false }).limit(200),
    db.from("social_accounts").select("id,account_name,platform_account_id").eq("business_id", business)
      .eq("platform", "facebook").eq("is_active", true),
    history,
    db.from("facebook_auto_reply_controls").select("paused,circuit_until").eq("business_id", business).maybeSingle(),
  ]);
  if (rules.error || pages.error || jobs.error || control.error) return reply({ error: "Auto Reply is unavailable. Check that its migrations have been installed." }, 503);
  return reply({ rules: rules.data, pages: pages.data, history: jobs.data,
    workerEnabled: process.env.FACEBOOK_AUTO_REPLY_WORKER_ENABLED === "true",
    paused: control.data?.paused ?? true, circuitUntil: control.data?.circuit_until ?? null,
    canManage: guard.context.permissions.channels === "manage" || guard.context.isOwner });
}

function postReference(input: string, pageId: string) {
  if (/^\d+_\d+$/.test(input)) return input;
  const url = new URL(input);
  if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)) throw new Error("Use a Facebook post link or Page_post ID.");
  const story = url.searchParams.get("story_fbid");
  const page = url.searchParams.get("id");
  if (story && page === pageId && /^\d+$/.test(story)) return `${pageId}_${story}`;
  const match = url.pathname.match(/\/posts\/(\d+)\/?$/);
  if (match) return `${pageId}_${match[1]}`;
  throw new Error("Use a /posts/ link or permalink.php link containing the post ID.");
}

export async function POST(request: NextRequest) {
  const guard = await requirePermission("channels", "manage");
  if (!guard.success) return guard.response;
  const business = guard.context.member.business_id;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") return reply({ error: "Invalid request." }, 400);
    if (body.operation === "draftPreview") {
      if (JSON.stringify(body).length > 262144) return reply({error:"Draft test is too large."},413);
      if (!uuid(body.channelId)) return reply({error:"Choose a connected channel."},400);
      const page = await db.from("social_accounts").select("id,platform").eq("id",body.channelId).eq("business_id",business).eq("is_active",true).maybeSingle();
      if(page.error)return reply({error:"Channel lookup unavailable."},503);
      if(!page.data)return reply({error:"Channel not found."},404);
      // Only Messenger-style hypothetical text plans are defined in this stage.
      if(page.data.platform!=="facebook")return reply({error:"Draft evaluation for this channel is unavailable."},422);
      const context={businessId:business,channelId:body.channelId};
      let rules,events;
      try{rules=parseDraftRules(body.rules,context);events=parseDraftEvents(body.events);}catch(error){return reply({error:(error as Error).message},400);}
      let staff:{id:string;load:number}[]=[];
      if(rules.some(r=>r.memberIds.length)){
        const teamGuard=await requirePermission("team_members","view");if(!teamGuard.success)return teamGuard.response;
        const members=await db.from("team_members").select("id").eq("business_id",business).eq("is_active",true).limit(100);
        if(members.error)return reply({error:"Staff lookup unavailable."},503);
        staff=(members.data??[]).map(m=>({id:m.id,load:0}));
      }
      try{return reply(previewDraftRules(rules,events,{...context,staff,now:body.now}));}
      catch(error){return reply({error:(error as Error).message},400);}
    }
    if (body.operation === "globalPause") {
      if (typeof body.paused !== "boolean") return reply({ error: "Invalid pause setting." }, 400);
      const { error } = await db.rpc("facebook_auto_reply_pause", { p_business: business, p_paused: body.paused });
      if (error) return reply({ error: "Could not change the global pause." }, 503);
      return reply({ success: true });
    }
    if (body.operation === "toggle") {
      if (!uuid(body.id) || typeof body.enabled !== "boolean") return reply({ error: "Invalid rule." }, 400);
      const startsAt = text(body.startsAt);
      if (body.enabled && (!/[zZ]|[+-]\d\d:\d\d$/.test(startsAt) || !Number.isFinite(Date.parse(startsAt)))) {
        return reply({ error: "Choose an explicit start date, time, and timezone before turning on." }, 400);
      }
      const { data, error } = await db.from("facebook_auto_reply_rules")
        .update({ enabled: body.enabled, ...(body.enabled ? { starts_at: new Date(startsAt).toISOString() } : {}) })
        .eq("id", body.id).eq("business_id", business).select("id,enabled,activated_at").maybeSingle();
      if (error) return reply({ error: "Could not change rule. Pause before changing the start time." }, 409);
      if (!data) return reply({ error: "Rule not found." }, 404);
      return reply({ success: true, rule: data });
    }
    if (body.operation === "test") {
      if (!uuid(body.id) || !/^[0-9_]+$/.test(text(body.commentId))) return reply({ error: "Choose a saved rule and a comment ID already in this inbox." }, 400);
      const { data: rule, error: re } = await db.from("facebook_auto_reply_rules").select("*")
        .eq("id", body.id).eq("business_id", business).maybeSingle();
      if (re) throw new Error("Rule lookup failed.");
      if (!rule) return reply({ error: "Rule not found." }, 404);
      const { data: message, error: me } = await db.from("messages")
        .select("id,conversation_id,sender_platform_id,platform_created_at,raw_payload").eq("business_id", business)
        .eq("platform_message_id", body.commentId).eq("direction", "incoming").maybeSingle();
      if (me) throw new Error("Comment lookup failed.");
      if (!message || message.raw_payload?.item !== "comment") return reply({ error: "Incoming comment not found." }, 404);
      const { data: conversation, error: ce } = await db.from("conversations").select("id")
        .eq("id", message.conversation_id).eq("social_account_id", rule.social_account_id).eq("business_id", business).maybeSingle();
      if (ce) throw new Error("Page lookup failed.");
      if (!conversation) return reply({ error: "Comment is not on the rule's connected Page." }, 404);
      const results = [];
      for (const action of ["public", "private"] as const) {
        if (!(action === "public" ? rule.public_template : rule.private_template)) continue;
        const check = await inspectAutoReply({ id: "dry-run", business_id: business, social_account_id: rule.social_account_id,
          rule_id: rule.id, message_id: message.id, comment_id: body.commentId, recipient_id: message.sender_platform_id,
          action, activation: rule.activated_at, status: "test", attempts: 0, claim_token: "", send_started_at: null,
          platform_reply_id: null, reason: null } as AutoReplyJob, true);
        results.push({ action, reason: check.reason ?? "eligible", template: action === "public" ? rule.public_template : rule.private_template });
      }
      return reply({ success: true, dryRun: true, enabled: rule.enabled, startsAt: rule.starts_at,
        activatedAt: rule.activated_at, results, note: "Read-only test. Nothing sent or queued. New-only cutoff still applies when enabled." });
    }
    const targets: { pageId: string; post?: string }[] = Array.isArray(body.targets) ? body.targets : [{ pageId: body.pageId, post: body.post }];
    if (body.operation !== "save" || !targets.length || targets.length > 20 ||
      targets.some(target => !target || !uuid(target.pageId)) || (body.id && (!uuid(body.id) || targets.length !== 1))) {
      return reply({ error: "Choose between 1 and 20 Page/post scopes. Edit each saved scope separately." }, 400);
    }
    const name = text(body.name); const publicTemplate = text(body.publicTemplate); const privateTemplate = text(body.privateTemplate);
    if (!name || name.length > 120 || (!publicTemplate && !privateTemplate) || publicTemplate.length > 8000 || privateTemplate.length > 2000) {
      return reply({ error: "Add a name and at least one reply. Public maximum: 8000 characters; private maximum: 2000." }, 400);
    }
    const values = [];
    const scopes = new Set<string>();
    for (const target of targets) {
    const { data: page, error: pe } = await db.from("social_accounts")
      .select("id,platform_account_id,is_active,facebook_token_status,facebook_page_access_token_encrypted")
      .eq("id", target.pageId).eq("business_id", business).eq("platform", "facebook").eq("is_active", true).maybeSingle();
    if (pe) throw new Error("Page lookup failed.");
    if (!page?.platform_account_id) return reply({ error: "Connected Page not found in this workspace." }, 404);
    let postId: string | null = null; let postUrl: string | null = null;
    if (body.scope === "specific") {
      try { postId = postReference(text(target.post), page.platform_account_id); }
      catch { return reply({ error: "Provide a valid Facebook post link or Page_post ID." }, 400); }
      const attempt = await autoReplyGraph(`${encodeURIComponent(postId)}?fields=id,from{id},permalink_url`,
        resolveStoredFacebookPageAccessToken(page));
      const post = attempt.result as typeof attempt.result & { permalink_url?: string };
      if (!attempt.response.ok || post.error || post.id !== postId || post.from?.id !== page.platform_account_id) {
        return reply({ error: "Facebook could not verify that this post belongs to the selected Page. Check the link and connection." }, 400);
      }
      postUrl = post.permalink_url ?? null;
    } else if (body.scope !== "all") return reply({ error: "Choose specific post or all posts." }, 400);
    const scopeKey = `${page.id}:${postId ?? "*"}`;
    if (scopes.has(scopeKey)) return reply({ error: "A Page/post scope was selected twice." }, 400);
    scopes.add(scopeKey);
    values.push({ name, business_id: business, social_account_id: page.id, post_id: postId, post_url: postUrl,
      public_template: publicTemplate || null, private_template: privateTemplate || null });
    }
    // One PostgREST INSERT is transactional: a conflicting scope rejects the entire selection.
    const query = body.id ? db.from("facebook_auto_reply_rules").update(values[0]).eq("id", body.id).eq("business_id", business).eq("enabled", false)
      : db.from("facebook_auto_reply_rules").insert(values);
    const { data, error } = await query.select("*");
    if (error) return reply({ error: error.code === "23505" ? "This Page already has a rule for that scope. Edit that rule." : "Could not save this rule." }, 409);
    if (!data?.length) return reply({ error: "Rule not found or still enabled. Pause before editing." }, 409);
    return reply({ success: true, rules: data });
  } catch {
    return reply({ error: "Unable to complete this request. Check the Page connection and retry." }, 503);
  }
}
