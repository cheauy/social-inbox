import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PeriodKey = "7d" | "30d" | "90d";

const PERIOD_DAYS: Record<PeriodKey, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function parsePeriod(
  value: string | null,
): PeriodKey {
  if (
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
  const periodDays = PERIOD_DAYS[period];
  const start = new Date(
    now.getTime() -
      periodDays * 24 * 60 * 60 * 1000,
  );

  const currentMember =
    authResult.member;

  const {
    data,
    error,
  } = await supabaseAdmin.rpc(
    "get_tenh_sla_analytics",
    {
      p_business_id:
        currentMember.business_id,
      p_start: start.toISOString(),
      p_end: now.toISOString(),
      p_sla_seconds:
        slaMinutes * 60,
      p_tz_offset_minutes:
        tzOffsetMinutes,
    },
  );

  if (error) {
    console.error(
      "[Tenh SLA V2.14] Unable to load analytics:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load SLA analytics.",
        details: error.message,
        hint:
          "Run supabase/01-v2-14-sla-response-analytics.sql first, then restart npm run dev.",
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
    periodDays,
    slaMinutes,
    start: start.toISOString(),
    end: now.toISOString(),
    analytics: data ?? {
      summary: {
        received: 0,
        responded: 0,
        waiting: 0,
        avgFirstResponseSeconds: 0,
        medianFirstResponseSeconds: 0,
        slaMet: 0,
        slaMissed: 0,
        slaWaiting: 0,
        slaRate: 100,
        resolved: 0,
        avgResolutionSeconds: 0,
      },
      daily: [],
      attention: [],
    },
  });
}
