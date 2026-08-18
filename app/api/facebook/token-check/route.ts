import { NextResponse } from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }

  if (
    authResult.member.role !==
    "owner"
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Only the workspace owner can check the Facebook Page token.",
      },
      {
        status: 403,
      },
    );
  }

  const pageId =
    process.env.FACEBOOK_PAGE_ID
      ?.trim();
  const version =
    process.env
      .FACEBOOK_GRAPH_API_VERSION
      ?.trim() || "v26.0";

  if (!pageId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Facebook Page configuration is missing.",
      },
      {
        status: 500,
      },
    );
  }

  let pageAccessToken: string;

  try {
    pageAccessToken =
      await getFacebookPageAccessToken(
        pageId,
      );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Facebook Page access token.",
      },
      {
        status: 500,
      },
    );
  }

  const url = new URL(
    `https://graph.facebook.com/${version}/me`,
  );

  url.searchParams.set(
    "fields",
    "id,name",
  );
  url.searchParams.set(
    "access_token",
    pageAccessToken,
  );

  const response = await fetch(
    url,
    {
      cache: "no-store",
    },
  );

  const result =
    await response.json();

  return NextResponse.json(
    result,
    {
      status: response.status,
    },
  );
}
