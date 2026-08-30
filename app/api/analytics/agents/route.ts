import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    value === "30d" ||
    value === "90d" ||
    value === "7d"
  ) {
    return value;
  }

  return "7d";
}

/**
 * Calendar-day boundaries in the caller's timezone, matching the
 * conversations and customers routes exactly. Without this, agent
 * "days" were UTC days: in UTC+7 everything before 07:00 local landed
 * in the previous day, so agent numbers never lined up with the other
 * panels.
 */
function getLocalCalendarParts(
  date: Date,
  tzOffsetMinutes: number,
) {
  const localClock = new Date(
    date.getTime() -
      tzOffsetMinutes * 60 * 1000,
  );

  return {
    year: localClock.getUTCFullYear(),
    month: localClock.getUTCMonth(),
    day: localClock.getUTCDate(),
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
    Date.UTC(year, month, day, 0, 0, 0, 0) +
      tzOffsetMinutes * 60 * 1000,
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
  const local = getLocalCalendarParts(
    now,
    tzOffsetMinutes,
  );

  const todayStart = localMidnightUtc({
    ...local,
    tzOffsetMinutes,
  });

  if (period === "today") {
    return { start: todayStart, end: now };
  }

  if (period === "yesterday") {
    return {
      start: localMidnightUtc({
        year: local.year,
        month: local.month,
        day: local.day - 1,
        tzOffsetMinutes,
      }),
      end: todayStart,
    };
  }

  const days = PERIOD_DAYS[period];

  return {
    start: new Date(
      now.getTime() -
        days * 24 * 60 * 60 * 1000,
    ),
    end: now,
  };
}

function parseInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(
    value ?? "",
    10,
  );

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(minimum, parsed),
  );
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
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }

  const period = parsePeriod(
    request.nextUrl.searchParams.get(
      "period",
    ),
  );

  const slaMinutes = parseInteger(
    request.nextUrl.searchParams.get(
      "slaMinutes",
    ),
    10,
    1,
    1440,
  );

  const tzOffsetMinutes = parseInteger(
    request.nextUrl.searchParams.get(
      "tzOffsetMinutes",
    ),
    0,
    -840,
    840,
  );

  const now = new Date();

  const range = getPeriodRange({
    period,
    now,
    tzOffsetMinutes,
  });

  const currentMember =
    authResult.member;

  const { data, error } =
    await supabaseAdmin.rpc(
      "get_tenh_agent_performance",
      {
        p_business_id:
          currentMember.business_id,
        p_start:
          range.start.toISOString(),
        p_end: range.end.toISOString(),
        p_sla_seconds:
          slaMinutes * 60,
      },
    );

  if (error) {
    console.error(
      "[Tenh Agent Analytics V2.14.1] Unable to load analytics:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load agent performance analytics.",
        ...(process.env.NODE_ENV !== "production"
          ? { details: error.message }
          : {}),
        ...(process.env.NODE_ENV !== "production"
          ? { hint: "Run supabase/01-v2-14-1-agent-response-attribution.sql first, then restart npm run dev." }
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
    slaMinutes,
    tzOffsetMinutes,
    start:
      range.start.toISOString(),
    end: range.end.toISOString(),
    analytics: data ?? {
      summary: {
        totalOutgoing: 0,
        attributedOutgoing: 0,
        unattributedOutgoing: 0,
        attributionRate: 100,
        totalFirstResponses: 0,
        attributedFirstResponses: 0,
        unattributedFirstResponses: 0,
        avgFirstResponseSeconds: 0,
        slaMet: 0,
        slaMissed: 0,
        slaRate: null,
      },
      agents: [],
    },
  });
}
