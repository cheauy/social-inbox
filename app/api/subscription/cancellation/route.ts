import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY = {
  success: false,
  error:
    "Subscription cancellation is not available. TENH uses prepaid billing: access expires automatically at the end of the paid period, then the owner can purchase a new plan and billing period.",
};

function gone() {
  return NextResponse.json(BODY, {
    status: 410,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET() {
  return gone();
}

export async function POST() {
  return gone();
}
