import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get(
    "hub.verify_token",
  );
  const challenge = request.nextUrl.searchParams.get(
    "hub.challenge",
  );

  const expectedToken =
    process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;

  if (
    mode === "subscribe" &&
    token === expectedToken &&
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
      error: "Facebook webhook verification failed.",
    },
    {
      status: 403,
    },
  );
}

export async function POST() {
  return NextResponse.json({
    received: true,
  });
}