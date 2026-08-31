import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

/**
 * Meta calls this endpoint with a GET request when the Instagram webhook
 * callback URL is registered in the App Dashboard.
 *
 * Required Vercel environment variable:
 *   INSTAGRAM_WEBHOOK_VERIFY_TOKEN
 */
export async function GET(
  request: NextRequest,
) {
  const mode =
    request.nextUrl.searchParams.get(
      "hub.mode",
    );
  const token =
    request.nextUrl.searchParams.get(
      "hub.verify_token",
    );
  const challenge =
    request.nextUrl.searchParams.get(
      "hub.challenge",
    );
  const verifyToken =
    process.env
      .INSTAGRAM_WEBHOOK_VERIFY_TOKEN
      ?.trim();

  if (!verifyToken) {
    console.error(
      "[TENH Instagram Webhook] INSTAGRAM_WEBHOOK_VERIFY_TOKEN is missing.",
    );

    return NextResponse.json(
      {
        error:
          "Instagram webhook security configuration is incomplete.",
      },
      {
        status: 503,
      },
    );
  }

  if (
    mode === "subscribe" &&
    token === verifyToken &&
    challenge
  ) {
    return new NextResponse(
      challenge,
      {
        status: 200,
        headers: {
          "Content-Type":
            "text/plain",
          "Cache-Control":
            "no-store",
        },
      },
    );
  }

  return NextResponse.json(
    {
      error:
        "Instagram webhook verification failed.",
    },
    {
      status: 403,
    },
  );
}

function isValidInstagramSignature({
  rawBody,
  signature,
  appSecret,
}: {
  rawBody: string;
  signature: string;
  appSecret: string;
}) {
  if (
    !signature.startsWith(
      "sha256=",
    )
  ) {
    return false;
  }

  const expected =
    `sha256=${createHmac(
      "sha256",
      appSecret,
    )
      .update(rawBody, "utf8")
      .digest("hex")}`;

  const actualBuffer =
    Buffer.from(
      signature,
      "utf8",
    );
  const expectedBuffer =
    Buffer.from(
      expected,
      "utf8",
    );

  if (
    actualBuffer.length !==
    expectedBuffer.length
  ) {
    return false;
  }

  return timingSafeEqual(
    actualBuffer,
    expectedBuffer,
  );
}

/**
 * Receives Instagram webhook events.
 *
 * This route intentionally only validates and acknowledges the payload for
 * now. Message/comment persistence is added separately when the Instagram
 * inbox integration is implemented.
 *
 * Required Vercel environment variable:
 *   INSTAGRAM_APP_SECRET
 */
export async function POST(
  request: NextRequest,
) {
  const appSecret =
    process.env
      .INSTAGRAM_APP_SECRET
      ?.trim();

  if (!appSecret) {
    console.error(
      "[TENH Instagram Webhook] INSTAGRAM_APP_SECRET is missing; refusing unsigned webhook processing.",
    );

    return NextResponse.json(
      {
        received: false,
        error:
          "Instagram webhook security configuration is incomplete.",
      },
      {
        status: 503,
      },
    );
  }

  const rawBody =
    await request.text();
  const signature =
    request.headers.get(
      "x-hub-signature-256",
    ) ?? "";

  if (
    !signature ||
    !isValidInstagramSignature({
      rawBody,
      signature,
      appSecret,
    })
  ) {
    return NextResponse.json(
      {
        received: false,
        error:
          "Invalid Instagram webhook signature.",
      },
      {
        status: 401,
      },
    );
  }

  let payload: unknown;

  try {
    payload =
      JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json(
      {
        received: false,
        error:
          "Invalid JSON payload.",
      },
      {
        status: 400,
      },
    );
  }

  // Do not log the full payload here: Instagram webhook bodies can contain
  // customer message/comment content. Event processing will be added when
  // the Instagram inbox integration is implemented.
  const object =
    payload &&
    typeof payload === "object" &&
    "object" in payload
      ? (payload as {
          object?: unknown;
        }).object
      : undefined;

  console.info(
    "[TENH Instagram Webhook] Valid webhook received.",
    {
      object:
        typeof object === "string"
          ? object
          : "unknown",
    },
  );

  return NextResponse.json(
    {
      received: true,
    },
    {
      status: 200,
    },
  );
}
