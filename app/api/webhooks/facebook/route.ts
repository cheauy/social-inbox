import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
) {
  const mode =
    request.nextUrl.searchParams.get("hub.mode");

  const token =
    request.nextUrl.searchParams.get(
      "hub.verify_token",
    );

  const challenge =
    request.nextUrl.searchParams.get(
      "hub.challenge",
    );

  if (
    mode === "subscribe" &&
    token ===
      process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN &&
    challenge
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  return NextResponse.json(
    {
      error:
        "Facebook webhook verification failed.",
    },
    {
      status: 403,
    },
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  console.log("FACEBOOK_WEBHOOK_POST");
  console.log(rawBody);

  return NextResponse.json({
    received: true,
  });
}