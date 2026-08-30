import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type PeriodKey =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "90d";

const PERIOD_DAYS: Record<
  "7d" | "30d" | "90d",
  number
> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function parsePeriod(
  value: string | null,
): PeriodKey {
  if (
    value === "today" ||
    value === "yesterday" ||
    value === "7d" ||
    value === "30d" ||
    value === "90d"
  ) {
    return value;
  }

  return "today";
}

function parseInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  // Number(null) is 0, not NaN, so a missing parameter used to skip the
  // fallback entirely and silently apply a 1-minute SLA. parseInt("")
  // yields NaN, which correctly falls through to the fallback.
  const parsed =
    Number.parseInt(
      value ?? "",
      10,
    );

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    return fallback;
  }

  return Math.min(
    Math.max(
      Math.trunc(
        parsed,
      ),
      minimum,
    ),
    maximum,
  );
}

function getLocalCalendarParts(
  date: Date,
  tzOffsetMinutes: number,
) {
  const localClock =
    new Date(
      date.getTime() -
        tzOffsetMinutes *
          60 *
          1000,
    );

  return {
    year:
      localClock.getUTCFullYear(),
    month:
      localClock.getUTCMonth(),
    day:
      localClock.getUTCDate(),
  };
}

function localMidnightUtc({
  year,
  month,
  day,
  tzOffsetMinutes,
}: {
  year: number;
  month: number;
  day: number;
  tzOffsetMinutes: number;
}) {
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      0,
      0,
      0,
      0,
    ) +
      tzOffsetMinutes *
        60 *
        1000,
  );
}

function getPeriodRange({
  period,
  now,
  tzOffsetMinutes,
}: {
  period: PeriodKey;
  now: Date;
  tzOffsetMinutes: number;
}) {
  const local =
    getLocalCalendarParts(
      now,
      tzOffsetMinutes,
    );

  const todayStart =
    localMidnightUtc({
      ...local,
      tzOffsetMinutes,
    });

  if (
    period === "today"
  ) {
    return {
      start:
        todayStart,
      end:
        now,
      label:
        "Today",
    };
  }

  if (
    period ===
    "yesterday"
  ) {
    return {
      start:
        localMidnightUtc({
          year:
            local.year,
          month:
            local.month,
          day:
            local.day - 1,
          tzOffsetMinutes,
        }),
      end:
        todayStart,
      label:
        "Yesterday",
    };
  }

  const days =
    PERIOD_DAYS[period];

  return {
    start:
      new Date(
        now.getTime() -
          days *
            24 *
            60 *
            60 *
            1000,
      ),
    end:
      now,
    label:
      period === "7d"
        ? "7 days"
        : period === "30d"
          ? "30 days"
          : "90 days",
  };
}

export async function GET(
  request: NextRequest,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  const period =
    parsePeriod(
      request.nextUrl.searchParams.get(
        "period",
      ),
    );

  const slaMinutes =
    parseInteger(
      request.nextUrl.searchParams.get(
        "slaMinutes",
      ),
      10,
      1,
      1440,
    );

  const tzOffsetMinutes =
    parseInteger(
      request.nextUrl.searchParams.get(
        "tzOffsetMinutes",
      ),
      0,
      -840,
      840,
    );

  const now =
    new Date();

  const range =
    getPeriodRange({
      period,
      now,
      tzOffsetMinutes,
    });

  const currentMember =
    authResult.member;

  const {
    data,
    error,
  } = await supabaseAdmin.rpc(
    "get_tenh_conversation_reports",
    {
      p_business_id:
        currentMember.business_id,
      p_start:
        range.start.toISOString(),
      p_end:
        range.end.toISOString(),
      p_sla_seconds:
        slaMinutes * 60,
      p_tz_offset_minutes:
        tzOffsetMinutes,
    },
  );

  if (error) {
    console.error(
      "[Tenh Conversation Reports V2.16] Unable to load:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load conversation reports.",
        ...(process.env.NODE_ENV !== "production"
          ? { details: error.message }
          : {}),
        ...(process.env.NODE_ENV !== "production"
          ? { hint: "Run supabase/01-v2-16-conversation-reports.sql first." }
          : {}),
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    businessId:
      currentMember.business_id,
    currentMemberId:
      currentMember.id,
    currentMemberRole:
      currentMember.role,
    period,
    periodLabel:
      range.label,
    slaMinutes,
    tzOffsetMinutes,
    start:
      range.start.toISOString(),
    end:
      range.end.toISOString(),
    analytics:
      data ?? {
        summary: {
          receivedConversations: 0,
          resolvedConversations: 0,
          resolutionRate: null,
          currentOpen: 0,
          currentPending: 0,
          currentResolved: 0,
          currentClosed: 0,
          currentSpam: 0,
          currentUnread: 0,
          currentUnassigned: 0,
          waitingOverSla: 0,
          incomingMessages: 0,
          outgoingMessages: 0,
          totalMessages: 0,
        },
        statuses: [],
        channels: [],
        busyHours: [],
        daily: [],
        waitingConversations: [],
      },
  });
}
