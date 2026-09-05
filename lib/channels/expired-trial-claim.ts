import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Releasing a channel that an expired free trial is still holding.
 *
 * A Page or Bot normally stays claimed by its workspace until someone
 * deliberately disconnects it. That protects a paying customer who is merely
 * late: their channel must not be taken while they sort billing out.
 *
 * An expired trial has none of that to protect. Nothing was paid, the seven
 * days are over, and the usual next step -- buy a plan, reconnect the channel --
 * used to strand the customer behind a claim only they could clear, from inside
 * a workspace they had already stopped using. So a claim held by an expired
 * trial is released automatically when the same channel is connected again.
 *
 * This has to write, not merely ignore. Both facebook_live_page_unique and
 * telegram_verified_bot_unique are partial unique indexes over the live rows,
 * so the old row must actually move to 'disconnected' before a new live row for
 * the same Page or Bot can exist.
 *
 * What it never does is delete. The old workspace keeps its row and every
 * conversation that hangs off it; only the credentials and the claim go.
 */

type TrialSubscriptionRow = {
  business_id: string;
  plan_code: string | null;
  status: string | null;
  last_paid_amount: number | string | null;
};

function neverPaid(
  value: number | string | null,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return true;
  }

  const amount = Number(value);

  return (
    !Number.isFinite(amount) || amount <= 0
  );
}

/**
 * Which of these workspaces are finished free trials that never paid.
 *
 * Deliberately narrow. `expired` only -- not `past_due`, `suspended` or
 * `cancelled`, which can all belong to a workspace that has paid before -- and
 * the payment check is belt and braces in case a plan_code is ever left as
 * "trial" on a subscription that went on to be billed.
 */
export async function loadExpiredTrialBusinessIds(
  businessIds: string[],
): Promise<Set<string>> {
  const unique = Array.from(
    new Set(businessIds.filter(Boolean)),
  );

  if (unique.length === 0) {
    return new Set();
  }

  const { data, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select(
      "business_id,plan_code,status,last_paid_amount",
    )
    .in("business_id", unique)
    .eq("plan_code", "trial")
    .eq("status", "expired");

  if (error) {
    throw new Error(
      `business_subscriptions: ${error.message}`,
    );
  }

  const rows = (data ??
    []) as TrialSubscriptionRow[];

  return new Set(
    rows
      .filter((row) =>
        neverPaid(row.last_paid_amount),
      )
      .map((row) => row.business_id),
  );
}

/** Give up the Facebook claims held by these social_accounts rows. */
export async function releaseFacebookTrialClaims(
  rowIds: string[],
) {
  if (rowIds.length === 0) {
    return;
  }

  const { error } = await supabaseAdmin
    .from("social_accounts")
    .update({
      is_active: false,
      facebook_page_access_token_encrypted:
        null,
      facebook_user_access_token_encrypted:
        null,
      facebook_user_token_expires_at: null,
      facebook_connected_at: null,
      facebook_token_status: "disconnected",
      facebook_token_last_error:
        "Released automatically: this free trial expired and the Page was connected to another subscription.",
      updated_at: new Date().toISOString(),
    })
    .in("id", rowIds);

  if (error) {
    throw new Error(
      `social_accounts (release): ${error.message}`,
    );
  }
}

/** Give up the Telegram claim held by this social_accounts row. */
export async function releaseTelegramTrialClaim(
  rowId: string,
) {
  const { error } = await supabaseAdmin
    .from("social_accounts")
    .update({
      is_active: false,
      telegram_bot_token_encrypted: null,
      telegram_token_status: "disconnected",
      telegram_connected_at: null,
      telegram_token_last_error: null,
      telegram_webhook_secret_encrypted: null,
      telegram_webhook_status: "disabled",
      telegram_webhook_url: null,
      telegram_webhook_registered_at: null,
      telegram_webhook_last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);

  if (error) {
    throw new Error(
      `social_accounts (release): ${error.message}`,
    );
  }
}
