import {
  NextRequest,
  NextResponse,
} from "next/server";

export async function GET(
  request: NextRequest,
) {
  const mode =
    request.nextUrl.searchParams.get("hub.mode");

  const verifyToken =
    request.nextUrl.searchParams.get(
      "hub.verify_token",
    );

  const challenge =
    request.nextUrl.searchParams.get(
      "hub.challenge",
    );

  const expectedToken =
    process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN;

  if (
    mode === "subscribe" &&
    verifyToken === expectedToken &&
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
    receivedMode: mode,
    receivedToken: verifyToken,
    tokenConfigured: Boolean(expectedToken),
    tokenMatches: verifyToken === expectedToken,
    challenge,
  },
  {
    status: 403,
  },
);
}