import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const pageAccessToken =
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION;

  if (!pageId || !pageAccessToken || !graphVersion) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing Facebook environment variables.",
        pageIdConfigured: Boolean(pageId),
        pageTokenConfigured: Boolean(pageAccessToken),
        graphVersionConfigured: Boolean(graphVersion),
      },
      {
        status: 500,
      },
    );
  }

  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`,
  );

  url.searchParams.set(
    "subscribed_fields",
    [
      "messages",
      "messaging_postbacks",
      "message_deliveries",
      "message_reads",
    ].join(","),
  );

  url.searchParams.set(
    "access_token",
    pageAccessToken,
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
    });

    const result: unknown = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "Facebook Page subscription failed.",
          details: result,
        },
        {
          status: response.status,
        },
      );
    }

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown request error.",
      },
      {
        status: 500,
      },
    );
  }
}