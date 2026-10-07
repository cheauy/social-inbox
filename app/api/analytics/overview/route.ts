import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ANALYTICS_PERIODS, analyticsTimezoneOffset, overviewRange, verifiedOverview, type AnalyticsPeriod } from "@/lib/analytics/overview-metrics";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request: NextRequest) {
  const auth=await getCurrentMember(true);
  const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{status,headers:{"Cache-Control":"no-store"}});
  if (!auth.success) return fail(auth.error,auth.status);
  const params=request.nextUrl.searchParams, expected=params.get("businessId");
  if (expected && expected!==auth.member.business_id) return fail("Workspace changed. Reload this view.",409);
  const period=params.get("period")??"today", timezone=params.get("timezone")??"UTC";
  const slaMinutes=Number(params.get("slaMinutes")??10);
  if (!ANALYTICS_PERIODS.includes(period as AnalyticsPeriod) || !Number.isInteger(slaMinutes)
    || slaMinutes<1 || slaMinutes>1440) return fail("Invalid analytics filters.",400);
  const snapshot=new Date(); let range: {start:Date;end:Date}; let tzOffsetMinutes:number;
  try { range=overviewRange(period as AnalyticsPeriod,snapshot,timezone); tzOffsetMinutes=analyticsTimezoneOffset(timezone,snapshot); }
  catch { return fail("Invalid analytics timezone.",400); }
  const {data,error}=await supabaseAdmin.rpc("get_tenh_analytics_overview",{
    p_business_id:auth.member.business_id,p_member_id:auth.member.id,p_user_id:auth.user.id,
    p_start:range.start.toISOString(),p_end:range.end.toISOString(),p_snapshot_at:snapshot.toISOString(),
    p_sla_seconds:slaMinutes*60,p_timezone:timezone,
  });
  if (error || !verifiedOverview(data)) return fail("Dashboard data is unavailable.",503);
  return NextResponse.json({success:true,businessId:auth.member.business_id,period,timezone,tzOffsetMinutes,slaMinutes,
    start:range.start.toISOString(),end:range.end.toISOString(),snapshotAt:snapshot.toISOString(),analytics:data},
    {headers:{"Cache-Control":"no-store"}});
}
