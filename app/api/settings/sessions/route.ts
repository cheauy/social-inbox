import { NextResponse } from "next/server";

import { listUserSessions } from "@/lib/auth/user-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await listUserSessions();

  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        error: result.error,
      },
      {
        status: result.status,
      },
    );
  }

  return NextResponse.json(
    {
      success: true,
      supported: result.supported,
      currentSessionId: result.currentSessionId,
      sessions: result.sessions,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
