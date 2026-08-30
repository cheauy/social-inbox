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
  // Number(null) is 0, not NaN, so a missing parameter used to skip
  // the fallback entirely. parseInt("") yields NaN, which falls
  // through correctly.
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(
    Math.max(
      Math.trunc(parsed),
      minimum,
    ),
    maximum,
  );
}

/*
 * JavaScript's getTimezoneOffset() returns:
 * UTC - local time.
 *
 * Cambodia / UTC+7 therefore sends -420.
 *
 * To convert a LOCAL midnight into UTC:
 * UTC = local + offset.
 */
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

function getLocalCalendarParts(
  date: Date,
  tzOffsetMinutes: number,
) {
  /*
   * Shift the UTC timestamp into the user's local
   * wall-clock time, then read it with UTC getters.
   */
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

  if (period === "today") {
    return {
      start:
        todayStart,
      end:
        now,
      periodDays: 1,
      label: "Today",
    };
  }

  if (
    period ===
    "yesterday"
  ) {
    const yesterdayStart =
      localMidnightUtc({
        year:
          local.year,
        month:
          local.month,
        day:
          local.day - 1,
        tzOffsetMinutes,
      });

    return {
      start:
        yesterdayStart,
      end:
        todayStart,
      periodDays: 1,
      label:
        "Yesterday",
    };
  }

  const periodDays =
    PERIOD_DAYS[period];

  return {
    start:
      new Date(
        now.getTime() -
          periodDays *
            24 *
            60 *
            60 *
            1000,
      ),
    end:
      now,
    periodDays,
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
    "get_tenh_customer_insights",
    {
      p_business_id:
        currentMember.business_id,
      p_start:
        range.start.toISOString(),
      p_end:
        range.end.toISOString(),
      p_tz_offset_minutes:
        tzOffsetMinutes,
    },
  );

  if (error) {
    console.error(
      "[Tenh Customer Insights V2.15.1] Unable to load analytics:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer insights.",
        ...(process.env.NODE_ENV !== "production"
          ? { details: error.message }
          : {}),
        ...(process.env.NODE_ENV !== "production"
          ? { hint: "Run the V2.15 customer-insights SQL first." }
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
    periodDays:
      range.periodDays,
    tzOffsetMinutes,
    start:
      range.start.toISOString(),
    end:
      range.end.toISOString(),
    analytics:
      data ?? {
        summary: {
          totalCustomers: 0,
          newCustomers: 0,
          activeCustomers: 0,
          returningCustomers: 0,
          inactive30Days: 0,
          openCustomers: 0,
          messagesInPeriod: 0,
          incomingMessages: 0,
          outgoingMessages: 0,
        },
        dailyGrowth: [],
        topCustomers: [],
        tags: [],
        channels: [],
      },
  });
}
