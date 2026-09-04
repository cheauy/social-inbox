import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-channel performance.
 *
 * There is no RPC for this, so every figure is computed here from
 * conversations, messages and social_accounts. The definitions are
 * deliberately visible in this file rather than hidden in SQL:
 *
 *   channel        one social_account, split by source_type so Facebook
 *                  comments are reported separately from Messenger DMs
 *                  on the same Page.
 *   conversations  conversations CREATED inside the window.
 *   incoming       messages with direction 'incoming' on those.
 *   replies        messages with direction 'outgoing' on those.
 *   firstResponse  gap between a conversation's creation and its first
 *                  outgoing message. Conversations that were never
 *                  replied to are EXCLUDED from the average and counted
 *                  in `unanswered`, so silence cannot flatter the mean.
 *   slaRate        share of ANSWERED conversations answered within
 *                  slaMinutes. null when nothing was answered — never
 *                  100, which would read as a perfect score for an
 *                  empty period.
 */

type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "90d";

const PERIOD_DAYS: Record<"7d" | "30d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function parsePeriod(value: string | null): PeriodKey {
  if (
    value === "today" ||
    value === "yesterday" ||
    value === "7d" ||
    value === "30d" ||
    value === "90d"
  ) {
    return value;
  }

  return "7d";
}

function parseInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

function getLocalCalendarParts(date: Date, tzOffsetMinutes: number) {
  const localClock = new Date(
    date.getTime() - tzOffsetMinutes * 60 * 1000,
  );

  return {
    year: localClock.getUTCFullYear(),
    month: localClock.getUTCMonth(),
    day: localClock.getUTCDate(),
  };
}

function localMidnightUtc(
  year: number,
  month: number,
  day: number,
  tzOffsetMinutes: number,
) {
  return new Date(
    Date.UTC(year, month, day, 0, 0, 0, 0) + tzOffsetMinutes * 60 * 1000,
  );
}

function getPeriodRange(
  period: PeriodKey,
  now: Date,
  tzOffsetMinutes: number,
) {
  const local = getLocalCalendarParts(now, tzOffsetMinutes);

  const todayStart = localMidnightUtc(
    local.year,
    local.month,
    local.day,
    tzOffsetMinutes,
  );

  if (period === "today") {
    return { start: todayStart, end: now };
  }

  if (period === "yesterday") {
    return {
      start: localMidnightUtc(
        local.year,
        local.month,
        local.day - 1,
        tzOffsetMinutes,
      ),
      end: todayStart,
    };
  }

  return {
    start: new Date(
      now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000,
    ),
    end: now,
  };
}

function localDateKey(iso: string, tzOffsetMinutes: number) {
  const parts = getLocalCalendarParts(new Date(iso), tzOffsetMinutes);

  return [
    parts.year,
    String(parts.month + 1).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

type ConversationRow = {
  id: string;
  social_account_id: string | null;
  platform: string | null;
  source_type: string | null;
  status: string | null;
  assigned_to: string | null;
  unread_count: number | null;
  contact_id: string | null;
  created_at: string;
};

type MessageRow = {
  conversation_id: string | null;
  direction: string | null;
  created_at: string;
};

type AccountRow = {
  id: string;
  platform: string | null;
  account_name: string | null;
};

type ChannelBucket = {
  key: string;
  socialAccountId: string | null;
  platform: string;
  sourceType: string;
  accountName: string;
  conversations: number;
  incomingMessages: number;
  outgoingReplies: number;
  firstResponseSeconds: number[];
  answered: number;
  unanswered: number;
  slaMet: number;
  slaMissed: number;
  open: number;
  pending: number;
  resolved: number;
  unread: number;
  unassigned: number;
  contactIds: Set<string>;
  daily: Map<string, { received: number; replied: number }>;
};

function averageSeconds(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function medianSeconds(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

export async function GET(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;
  const params = request.nextUrl.searchParams;

  const period = parsePeriod(params.get("period"));
  const slaMinutes = parseInteger(params.get("slaMinutes"), 10, 1, 1440);
  const tzOffsetMinutes = parseInteger(
    params.get("tzOffsetMinutes"),
    0,
    -840,
    840,
  );

  const now = new Date();
  const range = getPeriodRange(period, now, tzOffsetMinutes);

  // Same-length window immediately before this one, for "vs previous".
  const windowMs = range.end.getTime() - range.start.getTime();
  const previousStart = new Date(range.start.getTime() - windowMs);

  const [accountsResult, conversationsResult, previousResult] =
    await Promise.all([
      supabaseAdmin
        .from("social_accounts")
        .select("id, platform, account_name")
        .eq("business_id", currentMember.business_id),

      // Paged: PostgREST caps a plain select at 1,000 rows, which silently
      // under-counted every channel once a 30/90-day window grew past that.
      fetchAllRows<ConversationRow>(() =>
        supabaseAdmin
          .from("conversations")
          .select(
            "id, social_account_id, platform, source_type, status, assigned_to, unread_count, contact_id, created_at",
          )
          .eq("business_id", currentMember.business_id)
          .gte("created_at", range.start.toISOString())
          .lt("created_at", range.end.toISOString())
          .order("created_at", { ascending: true }),
      ),

      /*
       * "vs previous" only needs the count, so ask Postgres for it directly.
       * It must exclude comments the same way the current window does, or the
       * change percentage compares Messenger against Messenger-plus-comments
       * and reports a fall that never happened.
       */
      supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("business_id", currentMember.business_id)
        .or("source_type.is.null,source_type.neq.comment")
        .gte("created_at", previousStart.toISOString())
        .lt("created_at", range.start.toISOString()),
    ]);

  if (accountsResult.error || conversationsResult.error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load channel performance.",
        ...(process.env.NODE_ENV !== "production"
          ? {
              details:
                accountsResult.error?.message ??
                conversationsResult.error?.message,
            }
          : {}),
      },
      { status: 500 },
    );
  }

  const accounts = (accountsResult.data ?? []) as AccountRow[];
  const conversations = (conversationsResult.data ??
    []) as ConversationRow[];

  const accountById = new Map(
    accounts.map((account) => [account.id, account]),
  );

  const conversationIds = conversations.map((row) => row.id);

  // Chunked: a busy workspace would otherwise blow past the URL length
  // limit of a single .in() filter.
  const messages: MessageRow[] = [];
  const CHUNK = 200;

  for (let index = 0; index < conversationIds.length; index += CHUNK) {
    const slice = conversationIds.slice(index, index + CHUNK);

    // Paged as well: 200 conversations can easily hold more than 1,000
    // messages, and a truncated (ascending) read drops the newest replies.
    const { data, error } = await fetchAllRows<MessageRow>(() =>
      supabaseAdmin
        .from("messages")
        .select("conversation_id, direction, created_at")
        .eq("business_id", currentMember.business_id)
        .in("conversation_id", slice)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    );

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to load channel messages.",
          ...(process.env.NODE_ENV !== "production"
            ? { details: error.message }
            : {}),
        },
        { status: 500 },
      );
    }

    messages.push(...((data ?? []) as MessageRow[]));
  }

  const firstOutgoingAt = new Map<string, string>();
  const incomingByConversation = new Map<string, number>();
  const outgoingByConversation = new Map<string, number>();

  for (const message of messages) {
    if (!message.conversation_id) {
      continue;
    }

    if (message.direction === "outgoing") {
      outgoingByConversation.set(
        message.conversation_id,
        (outgoingByConversation.get(message.conversation_id) ?? 0) + 1,
      );

      if (!firstOutgoingAt.has(message.conversation_id)) {
        firstOutgoingAt.set(message.conversation_id, message.created_at);
      }
    } else if (message.direction === "incoming") {
      incomingByConversation.set(
        message.conversation_id,
        (incomingByConversation.get(message.conversation_id) ?? 0) + 1,
      );
    }
  }

  const buckets = new Map<string, ChannelBucket>();

  function bucketFor(row: ConversationRow) {
    const account = row.social_account_id
      ? accountById.get(row.social_account_id)
      : undefined;

    const platform = (
      row.platform ??
      account?.platform ??
      "unknown"
    ).toLowerCase();

    const sourceType =
      row.source_type === "comment" ? "comment" : "message";

    const key = `${row.social_account_id ?? platform}:${sourceType}`;

    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = {
        key,
        socialAccountId: row.social_account_id,
        platform,
        sourceType,
        accountName:
          account?.account_name?.trim() ||
          (platform === "unknown" ? "Unknown channel" : platform),
        conversations: 0,
        incomingMessages: 0,
        outgoingReplies: 0,
        firstResponseSeconds: [],
        answered: 0,
        unanswered: 0,
        slaMet: 0,
        slaMissed: 0,
        open: 0,
        pending: 0,
        resolved: 0,
        unread: 0,
        unassigned: 0,
        contactIds: new Set<string>(),
        daily: new Map(),
      };

      buckets.set(key, bucket);
    }

    return bucket;
  }

  const slaSeconds = slaMinutes * 60;

  for (const row of conversations) {
    const bucket = bucketFor(row);

    bucket.conversations += 1;
    bucket.incomingMessages += incomingByConversation.get(row.id) ?? 0;
    bucket.outgoingReplies += outgoingByConversation.get(row.id) ?? 0;

    if (row.contact_id) {
      bucket.contactIds.add(row.contact_id);
    }

    const status = (row.status ?? "").toLowerCase();

    if (status === "open") {
      bucket.open += 1;
    } else if (status === "pending") {
      bucket.pending += 1;
    } else if (status === "resolved" || status === "closed") {
      bucket.resolved += 1;
    }

    if ((row.unread_count ?? 0) > 0) {
      bucket.unread += 1;
    }

    if (!row.assigned_to) {
      bucket.unassigned += 1;
    }

    const dayKey = localDateKey(row.created_at, tzOffsetMinutes);
    const day = bucket.daily.get(dayKey) ?? { received: 0, replied: 0 };
    day.received += 1;

    const firstReply = firstOutgoingAt.get(row.id);

    if (firstReply) {
      const seconds = Math.max(
        0,
        Math.round(
          (new Date(firstReply).getTime() -
            new Date(row.created_at).getTime()) /
            1000,
        ),
      );

      bucket.firstResponseSeconds.push(seconds);
      bucket.answered += 1;
      day.replied += 1;

      if (seconds <= slaSeconds) {
        bucket.slaMet += 1;
      } else {
        bucket.slaMissed += 1;
      }
    } else {
      bucket.unanswered += 1;
    }

    bucket.daily.set(dayKey, day);
  }

  const channels = [...buckets.values()]
    .map((bucket) => ({
      key: bucket.key,
      socialAccountId: bucket.socialAccountId,
      platform: bucket.platform,
      sourceType: bucket.sourceType,
      accountName: bucket.accountName,
      conversations: bucket.conversations,
      incomingMessages: bucket.incomingMessages,
      outgoingReplies: bucket.outgoingReplies,
      newCustomers: bucket.contactIds.size,
      avgFirstResponseSeconds: averageSeconds(bucket.firstResponseSeconds),
      medianFirstResponseSeconds: medianSeconds(bucket.firstResponseSeconds),
      answered: bucket.answered,
      unanswered: bucket.unanswered,
      slaMet: bucket.slaMet,
      slaMissed: bucket.slaMissed,
      slaRate:
        bucket.answered > 0
          ? Math.round((bucket.slaMet / bucket.answered) * 100)
          : null,
      open: bucket.open,
      pending: bucket.pending,
      resolved: bucket.resolved,
      unread: bucket.unread,
      unassigned: bucket.unassigned,
      daily: [...bucket.daily.entries()]
        .map(([date, value]) => ({ date, ...value }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.conversations - a.conversations);

  /*
   * Summary figures count Messenger only. Each channel row is keyed by
   * source type, so summing every row counted comment threads as
   * conversations — the same overstatement the analytics SQL functions
   * carried. The per-channel rows below still report comments separately,
   * which is the point of splitting them.
   */
  const messengerChannels = channels.filter(
    (channel) => channel.sourceType !== "comment",
  );

  const totalConversations = messengerChannels.reduce(
    (sum, channel) => sum + channel.conversations,
    0,
  );

  const allFirstResponses = [...buckets.values()]
    .filter((bucket) => bucket.sourceType !== "comment")
    .flatMap((bucket) => bucket.firstResponseSeconds);

  const totalAnswered = messengerChannels.reduce(
    (sum, channel) => sum + channel.answered,
    0,
  );

  const totalSlaMet = messengerChannels.reduce(
    (sum, channel) => sum + channel.slaMet,
    0,
  );

  const previousConversations = previousResult.error
    ? null
    : (previousResult.count ?? 0);

  const conversationsChangePercent =
    previousConversations === null || previousConversations === 0
      ? null
      : Math.round(
          ((totalConversations - previousConversations) /
            previousConversations) *
            100,
        );

  return NextResponse.json({
    success: true,
    businessId: currentMember.business_id,
    period,
    slaMinutes,
    tzOffsetMinutes,
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    summary: {
      conversations: totalConversations,
      /*
       * Message counts stay across every channel, comments included: a reply
       * sent to a comment is still a message your team sent.
       */
      incomingMessages: channels.reduce(
        (sum, channel) => sum + channel.incomingMessages,
        0,
      ),
      outgoingReplies: channels.reduce(
        (sum, channel) => sum + channel.outgoingReplies,
        0,
      ),
      avgFirstResponseSeconds: averageSeconds(allFirstResponses),
      answered: totalAnswered,
      unanswered: messengerChannels.reduce(
        (sum, channel) => sum + channel.unanswered,
        0,
      ),
      slaRate:
        totalAnswered > 0
          ? Math.round((totalSlaMet / totalAnswered) * 100)
          : null,
      previousConversations,
      conversationsChangePercent,
    },
    channels,
  });
}
