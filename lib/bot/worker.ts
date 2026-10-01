import { TENH_BOT_AVAILABLE } from "./availability";
import "server-only";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { recordStoredBotMessage, runStoredBotJobs } from "./execution-store";
import { facebookBotTextTransport } from "./facebook-text-transport";
import { facebookBotCommentHideTransport } from "./facebook-comment-hide-transport";
import type { ExecutionJob } from "./execution-safety";

const internal = new Set<ExecutionJob["kind"]>(["assign", "alert", "handoff", "context", "health", "filter", "flow"]);
export async function runTenhBotWorker() {
  if (!TENH_BOT_AVAILABLE || process.env.TENH_BOT_EXECUTION_ENABLED !== "true") return { paused: true, processed: 0 };
  const recovery = await db.rpc("tenh_bot_recover_jobs", { p_limit: 10 });
  if (recovery.error) throw Error("bot_recovery_unavailable");
  const pending = await db.rpc("tenh_bot_pending_event_ids", { p_limit: 10 });
  if (pending.error || !Array.isArray(pending.data) || pending.data.length > 10) throw Error("bot_catchup_unavailable");
  for (const messageId of pending.data) await recordStoredBotMessage(messageId);
  return runStoredBotJobs({
    supported: job => internal.has(job.kind) || facebookBotTextTransport.supported(job) || facebookBotCommentHideTransport.supported(job),
    execute: async job => {
      if (!internal.has(job.kind)) return job.kind === "hide_comment" ? facebookBotCommentHideTransport.execute(job) : facebookBotTextTransport.execute(job);
      const result = await db.rpc("tenh_bot_execute_internal", { p_job: job.id, p_claim: job.claimToken });
      if (result.error || !result.data) throw Error("bot_internal_result_unknown");
      return result.data;
    },
  });
}
