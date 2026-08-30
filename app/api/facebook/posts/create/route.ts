import {
  NextRequest,
  NextResponse,
} from "next/server";

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

export async function POST(
  request: NextRequest,
) {
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


  try {
    const pageId =
      process.env.FACEBOOK_PAGE_ID
        ?.trim();

    const graphVersion =
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

    const pageAccessToken =
      await getFacebookPageAccessToken(
        pageId,
      );

    const incomingFormData =
      await request.formData();

    const photo =
      incomingFormData.get(
        "photo",
      );

    const caption = String(
      incomingFormData.get(
        "caption",
      ) ?? "",
    ).trim();

    if (!(photo instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: "Photo is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (!caption) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Caption is required.",
        },
        {
          status: 400,
        },
      );
    }

    const facebookFormData =
      new FormData();

    facebookFormData.append(
      "source",
      photo,
      photo.name,
    );
    facebookFormData.append(
      "caption",
      caption,
    );
    facebookFormData.append(
      "published",
      "true",
    );
    facebookFormData.append(
      "access_token",
      pageAccessToken,
    );

    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}/${pageId}/photos`,
      {
        method: "POST",
        body: facebookFormData,
        cache: "no-store",
      },
    );

    const responseText =
      await response.text();

    let result: {
      id?: string;
      post_id?: string;
      error?: {
        message?: string;
        type?: string;
        code?: number;
      };
    } = {};

    if (responseText.trim()) {
      try {
        result = JSON.parse(
          responseText,
        ) as typeof result;
      } catch {
        return NextResponse.json(
          {
            success: false,
            error:
              "Facebook returned invalid JSON.",
          },
          {
            status: 502,
          },
        );
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            result.error?.message ??
            "Unable to create Facebook post.",
        },
        {
          status:
            response.status,
        },
      );
    }

    return NextResponse.json({
      success: true,
      photoId:
        result.id ?? null,
      postId:
        result.post_id ?? null,
    });
  } catch (error) {
    console.error(
      "Create Facebook post error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to create Facebook post.",
      },
      {
        status: 500,
      },
    );
  }
}
