import { legacyAnalyticsGuard, legacyRpcAvailable } from "@/lib/analytics/legacy-visibility";
import { effectiveAnalyticsPeriod, explicitAnalyticsRange } from "@/lib/analytics/overview-metrics";
import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "90d";

const PERIOD_DAYS: Record<"7d" | "30d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function parsePeriod(
  value: string | null,
): PeriodKey {
  if (
    value === "today" || value === "yesterday" || value === "30d" ||
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
  const periodDays = period==="today"||period==="yesterday"?1:PERIOD_DAYS[period];
  const local = new Date(now.getTime()-tzOffsetMinutes*60000);
  const midnight=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())+tzOffsetMinutes*60000);
  const fallback=period==="today"?{start:midnight,end:now}:period==="yesterday"?{start:new Date(midnight.getTime()-86400000),end:midnight}:{start:new Date(now.getTime()-periodDays*86400000),end:now};
  const range=explicitAnalyticsRange(request.nextUrl.searchParams,now,fallback);
  if(!range)return NextResponse.json({success:false,error:"Invalid analytics date bounds."},{status:400});
  const start=range.start;
  const currentMember = authResult.member;
  const scopeDenied = await legacyAnalyticsGuard(currentMember.business_id,authResult.user.id,request.nextUrl.searchParams);
  if(scopeDenied)return scopeDenied;

  const {
    data,
    error,
  } = await supabaseAdmin.rpc(
    "get_tenh_sla_analytics",
    {
      p_business_id:
        currentMember.business_id,
      p_start: start.toISOString(),
      p_end: range.end.toISOString(),
      p_sla_seconds:
        slaMinutes * 60,
      p_tz_offset_minutes:
        tzOffsetMinutes,
    },
  );

  if (error || !legacyRpcAvailable(data,"sla")) {
    console.error(
      "[Tenh SLA V2.14] Unable to load analytics:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load SLA analytics.",
        ...(process.env.NODE_ENV !== "production"
          ? { details: error?.message }
          : {}),
        ...(process.env.NODE_ENV !== "production"
          ? { hint: "Run supabase/01-v2-14-sla-response-analytics.sql first, then restart npm run dev." }
          : {}),
      },
      {
        status: 500,
      },
    );
  }

  if(data.summary.slaMet+data.summary.slaMissed===0)data.summary.slaRate=null;
  const visibleData=data;

  return NextResponse.json({
    success: true,
    businessId:
      currentMember.business_id,
    currentMemberId:
      currentMember.id,
    currentMemberRole:
      currentMember.role,
    period: effectiveAnalyticsPeriod(request.nextUrl.searchParams,period),
    periodDays: Math.ceil((range.end.getTime()-range.start.getTime())/86400000),
    slaMinutes,
    start: start.toISOString(),
    end: range.end.toISOString(),
    analytics: visibleData ?? {
      summary: {
        received: 0,
        responded: 0,
        waiting: 0,
        avgFirstResponseSeconds: 0,
        medianFirstResponseSeconds: 0,
        slaMet: 0,
        slaMissed: 0,
        slaWaiting: 0,
        // null, not 100 — nothing happened, so nothing was met.
        // The agents route already reports null here.
        slaRate: null,
        resolved: 0,
        avgResolutionSeconds: 0,
      },
      daily: [],
      attention: [],
    },
  });
}
