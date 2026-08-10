import {
  randomUUID,
} from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

const BUCKET =
  "tenh-customer-files";

const MAX_FILE_SIZE =
  20 * 1024 * 1024;

const ALLOWED_EXACT_MIME_TYPES =
  new Set([
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
    "application/x-zip-compressed",
  ]);

type RouteContext = {
  params: Promise<{
    customerId: string;
  }>;
};

type FileActionBody = {
  action?:
    | "prepare-upload"
    | "finalize-upload"
    | "add-link"
    | "get-file-url";

  fileId?: string;

  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  storagePath?: string;

  conversationId?: string | null;
  description?: string | null;

  linkTitle?: string;
  linkUrl?: string;
};

function isAllowedMimeType(
  mimeType: string,
) {
  if (!mimeType) {
    return false;
  }

  return (
    mimeType.startsWith(
      "image/",
    ) ||
    mimeType.startsWith(
      "video/",
    ) ||
    mimeType.startsWith(
      "audio/",
    ) ||
    ALLOWED_EXACT_MIME_TYPES.has(
      mimeType,
    )
  );
}

function sanitizeFileName(
  value: string,
) {
  const fallback =
    "customer-file";

  const cleaned =
    value
      .normalize("NFKD")
      .replace(
        /[^\w.\-]+/g,
        "_",
      )
      .replace(
        /_+/g,
        "_",
      )
      .replace(
        /^[_\-.]+|[_\-.]+$/g,
        "",
      )
      .slice(0, 120);

  return (
    cleaned ||
    fallback
  );
}

function cleanDescription(
  value:
    | string
    | null
    | undefined,
) {
  const normalized =
    value?.trim() ?? "";

  if (!normalized) {
    return null;
  }

  return normalized.slice(
    0,
    2000,
  );
}

async function verifyContact({
  contactId,
  businessId,
}: {
  contactId: string;
  businessId: string;
}) {
  const {
    data,
    error,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      full_name
    `)
    .eq(
      "id",
      contactId,
    )
    .eq(
      "business_id",
      businessId,
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message,
    );
  }

  return data;
}

async function verifyConversation({
  conversationId,
  contactId,
  businessId,
}: {
  conversationId:
    | string
    | null
    | undefined;
  contactId: string;
  businessId: string;
}) {
  if (!conversationId) {
    return null;
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq(
      "id",
      conversationId,
    )
    .eq(
      "contact_id",
      contactId,
    )
    .eq(
      "business_id",
      businessId,
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message,
    );
  }

  return data?.id ?? null;
}

function normalizeUrl(
  raw:
    | string
    | undefined,
) {
  const value =
    raw?.trim();

  if (!value) {
    return null;
  }

  try {
    const url =
      new URL(value);

    if (
      url.protocol !==
        "https:" &&
      url.protocol !==
        "http:"
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

async function signedPreviewUrl({
  bucket,
  path,
}: {
  bucket: string | null;
  path: string | null;
}) {
  if (
    !bucket ||
    !path
  ) {
    return null;
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .storage
    .from(bucket)
    .createSignedUrl(
      path,
      10 * 60,
    );

  if (error) {
    console.error(
      "[Tenh Customer Files V2.18] Unable to sign preview URL:",
      error,
    );

    return null;
  }

  return (
    data?.signedUrl ??
    null
  );
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

  const {
    customerId,
  } =
    await context.params;

  /*
   * IMPORTANT:
   * TENH already uses /api/customers/[customerId].
   * Next.js requires the same dynamic segment name for every
   * route under /api/customers. The database entity is still
   * public.contacts, so we keep contactId as an internal alias.
   */
  const contactId =
    customerId;

  let contact;

  try {
    contact =
      await verifyContact({
        contactId,
        businessId:
          currentMember.business_id,
      });
  } catch (
    contactError
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to verify customer access.",
        details:
          contactError instanceof
            Error
            ? contactError.message
            : undefined,
      },
      {
        status: 500,
      },
    );
  }

  if (!contact) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  const {
    data: savedRows,
    error: savedError,
  } = await supabaseAdmin
    .from("customer_files")
    .select(`
      id,
      business_id,
      contact_id,
      conversation_id,
      item_type,
      display_name,
      storage_bucket,
      storage_path,
      external_url,
      mime_type,
      size_bytes,
      description,
      uploaded_by_member_id,
      created_at,
      updated_at,
      uploader:team_members!customer_files_uploaded_by_member_id_fkey (
        id,
        full_name,
        profile_picture_url
      )
    `)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "contact_id",
      contactId,
    )
    .is(
      "deleted_at",
      null,
    )
    .order(
      "created_at",
      {
        ascending: false,
      },
    );

  if (savedError) {
    console.error(
      "[Tenh Customer Files V2.18] Saved files query failed:",
      savedError,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load saved customer files.",
        details:
          savedError.message,
        hint:
          "Run supabase/01-v2-18-customer-files.sql first.",
      },
      {
        status: 500,
      },
    );
  }

  const savedFiles =
    await Promise.all(
      (savedRows ?? []).map(
        async (
          row,
        ) => {
          const previewUrl =
            row.item_type ===
            "file"
              ? await signedPreviewUrl(
                  {
                    bucket:
                      row.storage_bucket,
                    path:
                      row.storage_path,
                  },
                )
              : null;

          return {
            id: row.id,
            conversationId:
              row.conversation_id,
            itemType:
              row.item_type,
            displayName:
              row.display_name,
            externalUrl:
              row.external_url,
            mimeType:
              row.mime_type,
            sizeBytes:
              row.size_bytes,
            description:
              row.description,
            previewUrl,
            createdAt:
              row.created_at,
            updatedAt:
              row.updated_at,
            uploadedByMemberId:
              row.uploaded_by_member_id,
            uploader:
              Array.isArray(
                row.uploader,
              )
                ? row.uploader[0] ??
                  null
                : row.uploader ??
                  null,
          };
        },
      ),
    );

  const {
    data: conversations,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "contact_id",
      contactId,
    );

  if (
    conversationError
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer conversations.",
        details:
          conversationError.message,
      },
      {
        status: 500,
      },
    );
  }

  const conversationIds =
    (conversations ?? []).map(
      (conversation) =>
        conversation.id,
    );

  let attachments:
    Array<{
      id: string;
      conversationId: string;
      direction: string;
      messageType: string;
      messageText:
        | string
        | null;
      attachmentUrl: string;
      createdAt: string;
    }> = [];

  if (
    conversationIds.length >
    0
  ) {
    const {
      data:
        attachmentRows,
      error:
        attachmentError,
    } = await supabaseAdmin
      .from("messages")
      .select(`
        id,
        conversation_id,
        direction,
        message_type,
        message_text,
        attachment_url,
        platform_created_at,
        created_at
      `)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .in(
        "conversation_id",
        conversationIds,
      )
      .not(
        "attachment_url",
        "is",
        null,
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(60);

    if (
      attachmentError
    ) {
      console.error(
        "[Tenh Customer Files V2.18] Conversation attachment query failed:",
        attachmentError,
      );
    } else {
      attachments =
        (
          attachmentRows ??
          []
        )
          .filter(
            (
              row,
            ) =>
              Boolean(
                row.attachment_url,
              ),
          )
          .map(
            (
              row,
            ) => ({
              id:
                row.id,
              conversationId:
                row.conversation_id,
              direction:
                row.direction,
              messageType:
                row.message_type,
              messageText:
                row.message_text,
              attachmentUrl:
                row.attachment_url as string,
              createdAt:
                row.platform_created_at ??
                row.created_at,
            }),
          );
    }
  }

  return NextResponse.json({
    success: true,
    contact: {
      id:
        contact.id,
      fullName:
        contact.full_name ??
        "Facebook customer",
    },
    savedFiles,
    conversationAttachments:
      attachments,
  });
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

  const {
    customerId,
  } =
    await context.params;

  /*
   * IMPORTANT:
   * TENH already uses /api/customers/[customerId].
   * Next.js requires the same dynamic segment name for every
   * route under /api/customers. The database entity is still
   * public.contacts, so we keep contactId as an internal alias.
   */
  const contactId =
    customerId;

  const contact =
    await verifyContact({
      contactId,
      businessId:
        currentMember.business_id,
    }).catch(() => null);

  if (!contact) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  let body:
    FileActionBody;

  try {
    body =
      (await request.json()) as
        FileActionBody;
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

  if (
    body.action ===
    "prepare-upload"
  ) {
    const fileName =
      body.fileName?.trim() ??
      "";

    const mimeType =
      body.mimeType?.trim() ??
      "";

    const sizeBytes =
      Number(
        body.sizeBytes,
      );

    if (!fileName) {
      return NextResponse.json(
        {
          success: false,
          error:
            "File name is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !Number.isFinite(
        sizeBytes,
      ) ||
      sizeBytes <= 0 ||
      sizeBytes >
        MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Files must be larger than 0 bytes and no more than 20 MB.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !isAllowedMimeType(
        mimeType,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This file type is not supported.",
        },
        {
          status: 400,
        },
      );
    }

    const safeName =
      sanitizeFileName(
        fileName,
      );

    const storagePath =
      `${currentMember.business_id}/${contactId}/${randomUUID()}-${safeName}`;

    const {
      data,
      error,
    } = await supabaseAdmin
      .storage
      .from(BUCKET)
      .createSignedUploadUrl(
        storagePath,
        {
          upsert: false,
        },
      );

    if (
      error ||
      !data
    ) {
      console.error(
        "[Tenh Customer Files V2.18] Unable to create signed upload URL:",
        error,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to prepare the customer file upload.",
          details:
            error?.message,
          hint:
            "Make sure the V2.18 SQL created the tenh-customer-files bucket.",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      upload: {
        bucket:
          BUCKET,
        path:
          storagePath,
        token:
          data.token,
      },
    });
  }

  if (
    body.action ===
    "finalize-upload"
  ) {
    const fileName =
      body.fileName?.trim() ??
      "";

    const mimeType =
      body.mimeType?.trim() ??
      "";

    const sizeBytes =
      Number(
        body.sizeBytes,
      );

    const storagePath =
      body.storagePath?.trim() ??
      "";

    const expectedPrefix =
      `${currentMember.business_id}/${contactId}/`;

    if (
      !storagePath.startsWith(
        expectedPrefix,
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid customer file path.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !fileName ||
      !isAllowedMimeType(
        mimeType,
      ) ||
      !Number.isFinite(
        sizeBytes,
      ) ||
      sizeBytes <= 0 ||
      sizeBytes >
        MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid file metadata.",
        },
        {
          status: 400,
        },
      );
    }

    let conversationId:
      | string
      | null =
      null;

    try {
      conversationId =
        await verifyConversation({
          conversationId:
            body.conversationId,
          contactId,
          businessId:
            currentMember.business_id,
        });
    } catch {
      conversationId =
        null;
    }

    const {
      data: row,
      error,
    } = await supabaseAdmin
      .from("customer_files")
      .insert({
        business_id:
          currentMember.business_id,
        contact_id:
          contactId,
        conversation_id:
          conversationId,
        item_type:
          "file",
        display_name:
          fileName.slice(
            0,
            255,
          ),
        storage_bucket:
          BUCKET,
        storage_path:
          storagePath,
        external_url:
          null,
        mime_type:
          mimeType,
        size_bytes:
          Math.trunc(
            sizeBytes,
          ),
        description:
          cleanDescription(
            body.description,
          ),
        uploaded_by_member_id:
          currentMember.id,
      })
      .select(`
        id,
        display_name,
        created_at
      `)
      .single();

    if (
      error ||
      !row
    ) {
      /*
       * The upload already completed, so remove the orphaned
       * object when metadata cannot be saved.
       */
      await supabaseAdmin
        .storage
        .from(BUCKET)
        .remove([
          storagePath,
        ]);

      return NextResponse.json(
        {
          success: false,
          error:
            "The file uploaded, but TENH could not save its customer-file record.",
          details:
            error?.message,
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      file: row,
    });
  }

  if (
    body.action ===
    "add-link"
  ) {
    const externalUrl =
      normalizeUrl(
        body.linkUrl,
      );

    if (!externalUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Enter a valid http:// or https:// link.",
        },
        {
          status: 400,
        },
      );
    }

    const title =
      body.linkTitle?.trim() ||
      new URL(
        externalUrl,
      ).hostname;

    let conversationId:
      | string
      | null =
      null;

    try {
      conversationId =
        await verifyConversation({
          conversationId:
            body.conversationId,
          contactId,
          businessId:
            currentMember.business_id,
        });
    } catch {
      conversationId =
        null;
    }

    const {
      data: row,
      error,
    } = await supabaseAdmin
      .from("customer_files")
      .insert({
        business_id:
          currentMember.business_id,
        contact_id:
          contactId,
        conversation_id:
          conversationId,
        item_type:
          "link",
        display_name:
          title.slice(
            0,
            255,
          ),
        storage_bucket:
          null,
        storage_path:
          null,
        external_url:
          externalUrl,
        mime_type:
          null,
        size_bytes:
          null,
        description:
          cleanDescription(
            body.description,
          ),
        uploaded_by_member_id:
          currentMember.id,
      })
      .select(`
        id,
        display_name,
        external_url,
        created_at
      `)
      .single();

    if (
      error ||
      !row
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to save this customer link.",
          details:
            error?.message,
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      link: row,
    });
  }

  if (
    body.action ===
    "get-file-url"
  ) {
    const fileId =
      body.fileId?.trim();

    if (!fileId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "fileId is required.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      data: file,
      error,
    } = await supabaseAdmin
      .from("customer_files")
      .select(`
        id,
        item_type,
        storage_bucket,
        storage_path
      `)
      .eq(
        "id",
        fileId,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .eq(
        "contact_id",
        contactId,
      )
      .is(
        "deleted_at",
        null,
      )
      .maybeSingle();

    if (
      error ||
      !file
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Customer file was not found.",
        },
        {
          status: 404,
        },
      );
    }

    if (
      file.item_type !==
        "file" ||
      !file.storage_bucket ||
      !file.storage_path
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This item is not a stored file.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      data,
      error:
        signError,
    } = await supabaseAdmin
      .storage
      .from(
        file.storage_bucket,
      )
      .createSignedUrl(
        file.storage_path,
        5 * 60,
        {
          download: true,
        },
      );

    if (
      signError ||
      !data?.signedUrl
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to create a secure download link.",
          details:
            signError?.message,
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      signedUrl:
        data.signedUrl,
    });
  }

  return NextResponse.json(
    {
      success: false,
      error:
        "Unsupported customer-file action.",
    },
    {
      status: 400,
    },
  );
}
