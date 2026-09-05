import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { requirePermission } from "@/lib/auth/require-permission";
import {
  attachmentKindFor,
  isPathOwnedByBusiness,
  SAVED_REPLY_MEDIA_BUCKET,
  SAVED_REPLY_MEDIA_MAX_BYTES,
  SAVED_REPLY_MEDIA_PREFIX,
  supportedMediaTypes,
} from "@/lib/settings/saved-reply-attachments";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(
  error: string,
  status: number,
) {
  return NextResponse.json(
    { success: false, error },
    { status },
  );
}

function extensionFor(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    default:
      return "jpg";
  }
}

/**
 * Upload one file for a quick reply.
 *
 * The file lands under saved-replies/<businessId>/, which is what scopes it to
 * a workspace -- GET below refuses any path outside the caller's own prefix.
 * Nothing is written to saved_replies here: the row records the path only when
 * the reply itself is saved, so an abandoned form leaves an orphan file rather
 * than a broken reply.
 */
export async function POST(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const permissionGuard =
    await requirePermission(
      "tags_quick_replies",
      "manage",
    );

  if (!permissionGuard.success) {
    return permissionGuard.response;
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonError(
      "Unable to read the uploaded file.",
      400,
    );
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return jsonError(
      "Choose an image or video to upload.",
      400,
    );
  }

  const kind = attachmentKindFor(file.type);

  if (!kind) {
    return jsonError(
      `That file type is not supported. Allowed: ${supportedMediaTypes().join(", ")}.`,
      415,
    );
  }

  if (file.size <= 0) {
    return jsonError(
      "That file is empty.",
      400,
    );
  }

  if (file.size > SAVED_REPLY_MEDIA_MAX_BYTES) {
    return jsonError(
      `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Quick reply media must be ${
        SAVED_REPLY_MEDIA_MAX_BYTES /
        (1024 * 1024)
      } MB or smaller so it can be sent on both Messenger and Telegram.`,
      413,
    );
  }

  const businessId =
    authResult.member.business_id;
  const path = `${SAVED_REPLY_MEDIA_PREFIX}/${businessId}/${crypto.randomUUID()}.${extensionFor(
    file.type,
  )}`;

  const { error: uploadError } =
    await supabaseAdmin.storage
      .from(SAVED_REPLY_MEDIA_BUCKET)
      .upload(
        path,
        await file.arrayBuffer(),
        {
          contentType: file.type,
          upsert: false,
        },
      );

  if (uploadError) {
    console.error(
      `Unable to store quick reply media — ${uploadError.message}`,
    );

    return jsonError(
      "Unable to store that file. Try again.",
      500,
    );
  }

  return NextResponse.json({
    success: true,
    attachment: {
      path,
      kind,
      name: file.name || "attachment",
      size: file.size,
      mimeType: file.type,
    },
  });
}

/**
 * Hand back a short-lived signed URL for one stored file.
 *
 * The bucket is private, so this is how the form preview and the Inbox reach a
 * file. Authorization is the path prefix: a caller only ever sees files under
 * their own workspace, whatever path they ask for.
 */
export async function GET(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const path =
    request.nextUrl.searchParams
      .get("path")
      ?.trim() ?? "";

  if (!path) {
    return jsonError(
      "A file path is required.",
      400,
    );
  }

  if (
    !isPathOwnedByBusiness(
      path,
      authResult.member.business_id,
    )
  ) {
    /*
     * Not found rather than forbidden: a caller guessing paths should not be
     * able to learn which ones exist in another workspace.
     */
    return jsonError(
      "That file was not found.",
      404,
    );
  }

  const { data, error } =
    await supabaseAdmin.storage
      .from(SAVED_REPLY_MEDIA_BUCKET)
      .createSignedUrl(path, 60 * 10);

  if (error || !data?.signedUrl) {
    return jsonError(
      "That file was not found.",
      404,
    );
  }

  return NextResponse.json({
    success: true,
    url: data.signedUrl,
  });
}

/** Remove a stored file the workspace no longer references. */
export async function DELETE(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const permissionGuard =
    await requirePermission(
      "tags_quick_replies",
      "manage",
    );

  if (!permissionGuard.success) {
    return permissionGuard.response;
  }

  const path =
    request.nextUrl.searchParams
      .get("path")
      ?.trim() ?? "";

  if (
    !path ||
    !isPathOwnedByBusiness(
      path,
      authResult.member.business_id,
    )
  ) {
    return jsonError(
      "That file was not found.",
      404,
    );
  }

  const { error } =
    await supabaseAdmin.storage
      .from(SAVED_REPLY_MEDIA_BUCKET)
      .remove([path]);

  if (error) {
    console.error(
      `Unable to remove quick reply media — ${error.message}`,
    );

    return jsonError(
      "Unable to remove that file.",
      500,
    );
  }

  return NextResponse.json({ success: true });
}
