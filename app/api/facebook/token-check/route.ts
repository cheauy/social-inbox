import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const token =
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  const version =
    process.env.FACEBOOK_GRAPH_API_VERSION;

  if (!token || !version) {
    return NextResponse.json(
      {
        error: "Facebook token or version is missing.",
      },
      {
        status: 500,
      },
    );
  }

  const url = new URL(
    `https://graph.facebook.com/${version}/me`,
  );

  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", token);

  const response = await fetch(url, {
    cache: "no-store",
  });

  const result = await response.json();

  return NextResponse.json(result, {
    status: response.status,
  });
}