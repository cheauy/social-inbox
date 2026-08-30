import { NextRequest, NextResponse } from "next/server";

import {
  revokeOtherSessions,
  revokeSession,
} from "@/lib/auth/user-sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RevokeBody = {
  scope?: unknown;
  sessionId?: unknown;
};

export async function POST(request: NextRequest) {
  let body: RevokeBody;

  try {
    body = (await request.json()) as RevokeBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid request body.",
      },
      { status: 400 },
    );
  }

  const scope =
    typeof body.scope === "string" ? body.scope : "session";

  if (scope === "others") {
    const result = await revokeOtherSessions();

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
        },
        { status: result.status },
      );
    }

    return NextResponse.json({ success: true });
  }

  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!UUID_PATTERN.test(sessionId)) {
    return NextResponse.json(
      {
        success: false,
        error: "A valid sessionId is required.",
      },
      { status: 400 },
    );
  }

  const result = await revokeSession(sessionId);

  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        error: result.error,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({ success: true });
}
