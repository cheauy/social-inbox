import "server-only";
import { NextResponse } from "next/server";
import { hiddenPersonalAccountIds } from "@/lib/telegram-personal/visibility";

const required:Record<string,string[]>={
  conversations:["receivedConversations","resolvedConversations","currentOpen","currentPending","currentResolved","currentClosed","currentSpam","currentUnread","currentUnassigned","waitingOverSla","incomingMessages","outgoingMessages","totalMessages"],
  customers:["totalCustomers","newCustomers","activeCustomers","returningCustomers","inactive30Days","openCustomers","messagesInPeriod","incomingMessages","outgoingMessages"],
  sla:["received","responded","waiting","avgFirstResponseSeconds","medianFirstResponseSeconds","slaMet","slaMissed","slaWaiting","resolved","avgResolutionSeconds"],
  agents:["totalOutgoing","attributedOutgoing","unattributedOutgoing","totalFirstResponses","attributedFirstResponses","unattributedFirstResponses","avgFirstResponseSeconds","slaMet","slaMissed"],
};
const arrays:Record<string,Record<string,string[]>>={
  conversations:{daily:["received","resolved"],channels:["conversations","incomingMessages"],statuses:["conversations"],busyHours:["hour","conversations"],waitingConversations:["unreadCount","waitingSeconds"]},
  customers:{dailyGrowth:["newCustomers"],channels:["messages","customers","conversations"],tags:["customers"],topCustomers:["messages","conversations","incomingMessages","outgoingMessages"]},
  sla:{daily:["received","responded","avgFirstResponseSeconds","slaMet","slaMissed"],attention:["elapsedSeconds"]},
  agents:{agents:["firstResponses","avgFirstResponseSeconds","medianFirstResponseSeconds","slaMet","slaMissed","outgoingMessages","conversationsReplied","resolvedActions"]},
};
export function legacyRpcAvailable(value:unknown,report:keyof typeof required) {
  if(!value||typeof value!=="object"||!("summary" in value)||!value.summary||typeof value.summary!=="object")return false;
  const summary=value.summary as Record<string,unknown>;
  const finite=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
  const rate=(v:unknown)=>v===null||(finite(v)&&(v as number)<=100);
  const payload=value as Record<string,unknown>;
  if(!required[report].every(key=>finite(summary[key])))return false;
  if((report==="sla"||report==="agents")&&!rate(summary.slaRate))return false;
  if(report==="agents"&&!rate(summary.attributionRate))return false;
  if(report==="conversations"&&!rate(summary.resolutionRate))return false;
  return Object.entries(arrays[report]).every(([key,fields])=>Array.isArray(payload[key])&&(payload[key] as unknown[]).every(row=>
    row!==null&&typeof row==="object"&&fields.every(field=>finite((row as Record<string,unknown>)[field]))));
}

/** Existing RPCs cannot exclude private channels. Reject BEFORE aggregation. */
export async function legacyAnalyticsGuard(businessId:string,userId:string,params:URLSearchParams) {
  const expected=params.get("businessId");
  if(expected&&expected!==businessId)return NextResponse.json({success:false,error:"Workspace changed. Reload this view."},{status:409});
  try {
    if((await hiddenPersonalAccountIds([businessId],userId)).length) return NextResponse.json({success:false,
      error:"This report's aggregate cannot exclude restricted channels. Metrics are unavailable until a permission-scoped RPC is validated."},{status:403});
  } catch {return NextResponse.json({success:false,error:"Unable to verify analytics channel visibility."},{status:503});}
  return null;
}
