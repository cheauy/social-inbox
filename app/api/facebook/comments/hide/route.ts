import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";

import {
  FacebookCommentContextError,
  loadAuthorizedFacebookCommentActionContext,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HideCommentBody = {
  commentId?: string;
  hidden?: boolean;
};

type GraphResult = {
  id?: string;
  success?: boolean;
  is_hidden?: boolean;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

async function readGraphResult(
  response: Response,
): Promise<GraphResult> {
  const text =
    await response.text();

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(
      text,
    ) as GraphResult;
  } catch {
    return {};
  }
}

export async function POST(
  request: NextRequest,
) {
  try {
    let body: HideCommentBody;

    try {
      body =
        (await request.json()) as HideCommentBody;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid JSON request.",
        },
        {
          status: 400,
        },
      );
    }

    const commentId =
      body.commentId?.trim();
    const hidden =
      body.hidden ?? true;

    if (!commentId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "commentId is required.",
        },
        {
          status: 400,
        },
      );
    }

    const context =
      await loadAuthorizedFacebookCommentActionContext({
        commentId,
      });

    const currentMember = context.member;

    if (
      !(await memberHasPermission(currentMember, "conversations", "manage"))
    ) {
      return permissionDenied(
        "You do not have permission to reply in this workspace.",
      );
    }

    const graphVersion =
      process.env
        .FACEBOOK_GRAPH_API_VERSION
        ?.trim() || "v26.0";

    /*
     * Graph's Comment update edge is documented as POST /{comment_id} with
     * is_hidden. Use form encoding instead of a JSON body because this edge is
     * historically parameter/form based and some Graph versions do not apply
     * the JSON field reliably.
     */
    const form = new URLSearchParams();
    form.set(
      "is_hidden",
      hidden ? "true" : "false",
    );
    form.set(
      "access_token",
      context.pageAccessToken,
    );

    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}/${commentId}`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: form.toString(),
        cache: "no-store",
      },
    );

    const result =
      await readGraphResult(
        response,
      );

    if (
      !response.ok ||
      result.success === false ||
      result.error
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            result.error?.message ??
            "Unable to update Facebook comment visibility.",
          details:
            result.error ?? result,
        },
        {
          status:
            response.status || 500,
        },
      );
    }

    /* Best-effort verification so TENH does not show Hidden when Meta kept it visible. */
    let verifiedHidden:
      boolean | null = null;

    try {
      const verifyUrl = new URL(
        `https://graph.facebook.com/${graphVersion}/${commentId}`,
      );
      verifyUrl.searchParams.set(
        "fields",
        "is_hidden",
      );
      verifyUrl.searchParams.set(
        "access_token",
        context.pageAccessToken,
      );

      const verifyResponse =
        await fetch(verifyUrl, {
          cache: "no-store",
        });
      const verifyResult =
        await readGraphResult(
          verifyResponse,
        );

      if (
        verifyResponse.ok &&
        typeof verifyResult.is_hidden ===
          "boolean"
      ) {
        verifiedHidden =
          verifyResult.is_hidden;
      }
    } catch {
      // The update already succeeded. Verification is intentionally best-effort.
    }

    if (
      verifiedHidden !== null &&
      verifiedHidden !== hidden
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Meta accepted the request but the comment visibility did not change. Check the Page token permissions for this Page.",
          hidden:
            verifiedHidden,
        },
        {
          status: 502,
        },
      );
    }

    const { error: databaseError } =
      await supabaseAdmin
        .from("messages")
        .update({
          comment_is_hidden:
            hidden,
        })
        .eq(
          "id",
          context.message.id,
        )
        .eq(
          "business_id",
          currentMember.business_id,
        );

    if (databaseError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Facebook updated the comment visibility, but TENH could not save the local state.",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      hidden,
      verified:
        verifiedHidden !== null,
      pageId:
        context.pageId,
    });
  } catch (error) {
    if (
      error instanceof
      FacebookCommentContextError
    ) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        {
          status: error.status,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to update Facebook comment.",
      },
      {
        status: 500,
      },
    );
  }
}
