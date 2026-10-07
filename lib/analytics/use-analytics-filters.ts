"use client";
import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { getActiveWorkspaceUiId, TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT } from "@/lib/display/workspace-storage";
import { ANALYTICS_PERIODS, analyticsTimezoneOffset, type AnalyticsPeriod } from "./overview-metrics";

const subscribe=(listener:()=>void)=>{window.addEventListener(TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,listener);return()=>window.removeEventListener(TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,listener);};
export function useAnalyticsFilters(defaultPeriod:AnalyticsPeriod="today") {
  const params=useSearchParams(),businessId=useSyncExternalStore(subscribe,getActiveWorkspaceUiId,()=>"default");
  const requested=params.get("period"),period=ANALYTICS_PERIODS.includes(requested as AnalyticsPeriod)?requested as AnalyticsPeriod:defaultPeriod;
  const requestedSla=Number(params.get("slaMinutes")??10),slaMinutes=Number.isInteger(requestedSla)&&requestedSla>=1&&requestedSla<=1440?requestedSla:10;
  const localTimezone=typeof window==="undefined"?"UTC":Intl.DateTimeFormat().resolvedOptions().timeZone;
  let timezone=params.get("timezone")??localTimezone;
  try { new Intl.DateTimeFormat("en",{timeZone:timezone}); } catch { timezone=localTimezone; }
  const query=new URLSearchParams(params.toString());query.delete("view");query.delete("start");query.delete("end");
  query.set("period",period);query.set("slaMinutes",String(slaMinutes));query.set("timezone",timezone);
  query.set("tzOffsetMinutes",String(analyticsTimezoneOffset(timezone)));
  if (businessId!=="default") query.set("businessId",businessId); else query.delete("businessId");
  // Existing report pages can consume the exact bounds in an overview drilldown.
  for (const key of ["start","end"]) { const value=params.get(key);if(value)query.set(key,value); }
  const update=(key:string,value:string)=>{const url=new URL(window.location.href);url.searchParams.set(key,value);
    url.searchParams.delete("start");url.searchParams.delete("end");
    window.history.replaceState(null,"",`${url.pathname}${url.search}${url.hash}`);};
  return {period,slaMinutes,timezone,businessId,query:query.toString(),
    setPeriod:(value:AnalyticsPeriod)=>update("period",value),setSlaMinutes:(value:number)=>update("slaMinutes",String(value)),
    setTimezone:(value:string)=>update("timezone",value)};
}
