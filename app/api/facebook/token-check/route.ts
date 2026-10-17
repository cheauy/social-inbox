import { NextResponse } from "next/server";
import { getWorkspaceFacebookPage, WorkspaceFacebookPageError } from "@/lib/facebook/get-workspace-facebook-page";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

  // Was owner-only. The channels permission makes the
  // Roles & permissions setting meaningful; Owners always pass.
  if (
    !(await memberHasPermission(authResult.member, "channels", "manage"))
  ) {
    return permissionDenied(
      "You do not have permission to manage channels in this workspace.",
    );
  }


  const version =
    process.env
      .FACEBOOK_GRAPH_API_VERSION
      ?.trim() || "v26.0";

  let pageAccessToken: string;

  try {
    const page = await getWorkspaceFacebookPage(authResult.member.business_id, new URL(request.url).searchParams.get("socialAccountId"));
    pageAccessToken =
      await getFacebookPageAccessToken(
        page.pageId,
        page.id,
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
        status: error instanceof WorkspaceFacebookPageError ? error.status : 500,
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
