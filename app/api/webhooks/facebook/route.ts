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

export async function POST(
  request: NextRequest,
) {
  const payload: unknown = await request.json();

  console.log(
    "Facebook webhook received:",
    JSON.stringify(payload),
  );

  const { error } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      platform: "facebook",
      event_type: "page",
      payload,
      processing_status: "pending",
    });

  if (error) {
    console.error(
      "Unable to save webhook:",
      error,
    );

    return NextResponse.json(
      {
        received: false,
        error: error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    received: true,
  });
}