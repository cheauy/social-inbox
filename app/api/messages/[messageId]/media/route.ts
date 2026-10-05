import { cachedSignedUrls } from "@/lib/media/signed-urls";
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
import {
  TELEGRAM_MESSAGE_MEDIA_BUCKET,
  TENH_TELEGRAM_OUTGOING_PHOTO_MAX_BYTES,
  telegramMessageMediaStoragePath,
} from "@/lib/telegram/telegram-message-media";
import { canSeePersonalAccount, personalAccountFromMessageKey } from "@/lib/telegram-personal/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    messageId: string;
  }>;
};

type MessageRow = {
  id: string;
  business_id: string;
  platform_message_id: string;
  message_type: string;
  raw_payload?: {
    tenh_image_album?: {
      count?: number;
      saved_indices?: number[];
    };
    tenh_deleted?: unknown;
    tenh_attachment?: {
      type?: unknown;
      mime_type?: unknown;
      size?: unknown;
    };
  };
};

function legacyTelegramVideoSize(
  message: MessageRow,
) {
  const attachment =
    message.raw_payload
      ?.tenh_attachment;
  const mimeType =
    typeof attachment?.mime_type === "string"
      ? attachment.mime_type
          .split(";")[0]
          .trim()
          .toLowerCase()
      : "";
  const size = attachment?.size;

  if (
    message.message_type !== "video" ||
    !message.platform_message_id.startsWith("telegram:") ||
    attachment?.type !== "image" ||
    mimeType !== "video/mp4" ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size >
      TENH_TELEGRAM_OUTGOING_PHOTO_MAX_BYTES
  ) {
    return null;
  }

  return size;
}

function responseObjectSize(
  response: Response,
) {
  const contentRange =
    response.headers.get("content-range");
  const totalMatch =
    contentRange?.match(
      /^bytes\s+\d+-\d+\/(\d+)$/i,
    );

  if (totalMatch) {
    const total = Number(totalMatch[1]);
    return Number.isSafeInteger(total)
      ? total
      : null;
  }

  const contentLength = Number(
    response.headers.get("content-length"),
  );

  return Number.isSafeInteger(contentLength) &&
    contentLength >= 0
    ? contentLength
    : null;
}

function hasMp4FileTypeBox(
  bytes: Uint8Array,
) {
  return (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

async function validatedLegacyTelegramVideo(
  signedUrl: string,
  expectedSize: number,
) {
  let validationResponse: Response;

  try {
    validationResponse = await fetch(
      signedUrl,
      {
        headers: {
          Range: "bytes=0-11",
        },
        cache: "no-store",
      },
    );
  } catch {
    return false;
  }

  if (
    validationResponse.status !== 200 &&
    validationResponse.status !== 206
  ) {
    return false;
  }

  const objectSize =
    responseObjectSize(
      validationResponse,
    );

  if (objectSize !== expectedSize) {
    return false;
  }

  try {
    const bytes = new Uint8Array(
      await validationResponse.arrayBuffer(),
    );
    return hasMp4FileTypeBox(bytes);
  } catch {
    return false;
  }
}

async function proxyLegacyTelegramVideo({
  request,
  signedUrl,
  expectedSize,
}: {
  request: NextRequest;
  signedUrl: string;
  expectedSize: number;
}) {
  if (
    !(await validatedLegacyTelegramVideo(
      signedUrl,
      expectedSize,
    ))
  ) {
    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  const range =
    request.headers.get("range");

  if (
    range &&
    !/^bytes=(?:\d+-\d*|-\d+)$/i.test(
      range.trim(),
    )
  ) {
    return new NextResponse(
      null,
      {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control":
            "private, no-store",
          "Content-Range":
            `bytes */${expectedSize}`,
          "Content-Type": "video/mp4",
        },
      },
    );
  }

  let upstream: Response;

  try {
    upstream = await fetch(
      signedUrl,
      {
        headers: range
          ? { Range: range }
          : undefined,
        cache: "no-store",
      },
    );
  } catch {
    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  if (
    ![200, 206, 416].includes(
      upstream.status,
    )
  ) {
    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  const headers = new Headers({
    "Cache-Control":
      "private, no-store",
    "Content-Type": "video/mp4",
    "Accept-Ranges":
      upstream.headers.get(
        "accept-ranges",
      ) ?? "bytes",
  });

  for (const name of [
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value =
      upstream.headers.get(name);

    if (value) {
      headers.set(name, value);
    }
  }

  return new NextResponse(
    upstream.status === 416
      ? null
      : upstream.body,
    {
      status: upstream.status,
      headers,
    },
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
        error: authResult.error,
      },
      {
        status:
          authResult.status,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }

  const { messageId } =
    await context.params;

  if (!messageId?.trim()) {
    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from("messages")
      .select(
        "id,business_id,platform_message_id,message_type,raw_payload",
      )
      .eq("id", messageId)
      .eq(
        "business_id",
        authResult.member
          .business_id,
      )
      .maybeSingle();

  if (error) {
    console.error(
      "[TENH Media] Unable to load Telegram message:",
      error,
    );

    return new NextResponse(
      null,
      { status: 500 },
    );
  }

  const message =
    data as unknown as
      MessageRow | null;

  // Telegram Personal messages are only served to members allowed to see the chat.
  const personalAccount = personalAccountFromMessageKey(message?.platform_message_id);
  if (personalAccount && !(await canSeePersonalAccount(personalAccount, authResult.user.id))) {
    return new NextResponse(null, { status: 404 });
  }

  if (
    !message ||
    ![
      "image",
      "video",
      "file",
      "audio",
      "voice",
      "sticker",
    ].includes(
      message.message_type,
    ) ||
    /*
     * Telegram media is stored on the way in; a Messenger attachment we sent
     * is stored on the way out, under the same scheme. Both are private
     * objects served through here, so the test is whether a copy exists --
     * which the signed-URL call below answers -- not which network it came
     * from. Requiring a telegram: id meant every photo this workspace sent
     * through Messenger drew as a bubble with no picture in it.
     */
    false
  ) {
    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  const mediaKind =
    message.message_type ===
      "image"
      ? "photo"
      : message.message_type ===
          "video"
        ? "video"
        : message.message_type ===
            "audio"
          ? "audio"
          : message.message_type ===
              "voice"
            ? "voice"
            : "file";

  const photoIndexValue = _request.nextUrl.searchParams.get("photoIndex");
  const photoIndex = photoIndexValue === null ? 0 : Number(photoIndexValue);
  const album = message.raw_payload?.tenh_image_album;
  if (message.raw_payload?.tenh_deleted || (photoIndexValue !== null &&
      (!/^(0|[1-9]\d*)$/.test(photoIndexValue) || !Number.isSafeInteger(photoIndex) ||
       photoIndex >= (album?.count ?? 0) || !album?.saved_indices?.includes(photoIndex)))) {
    return new NextResponse(null,{status:404});
  }

  const storagePath =
    telegramMessageMediaStoragePath({
      businessId:
        authResult.member
          .business_id,
      messageId:
        message.id,
      mediaKind,
    }) + (photoIndex ? `-${photoIndex}` : "");

  const {
    data: signed,
    error: signedError,
  } =
    await cachedSignedUrls(TELEGRAM_MESSAGE_MEDIA_BUCKET, [storagePath], 300).then(data => ({ data: data[0], error: null }), (error: Error) => ({ data: null, error }));

  if (signedError) {
    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  if (!signed?.signedUrl) {
    const legacyVideoSize =
      legacyTelegramVideoSize(
        message,
      );

    if (
      legacyVideoSize !== null &&
      photoIndex === 0
    ) {
      const legacyStoragePath =
        telegramMessageMediaStoragePath({
          businessId:
            authResult.member
              .business_id,
          messageId:
            message.id,
          mediaKind: "photo",
        });
      const legacySigned =
        await cachedSignedUrls(
          TELEGRAM_MESSAGE_MEDIA_BUCKET,
          [legacyStoragePath],
          300,
        ).then(
          (links) => links[0] ?? null,
          () => null,
        );

      if (legacySigned?.signedUrl) {
        return proxyLegacyTelegramVideo({
          request: _request,
          signedUrl:
            legacySigned.signedUrl,
          expectedSize:
            legacyVideoSize,
        });
      }
    }

    return new NextResponse(
      null,
      { status: 404 },
    );
  }

  /*
   * Redirect instead of proxying the photo bytes through Vercel. The object
   * stays private and the generated Supabase URL expires after five minutes.
   */
  return NextResponse.redirect(
    signed.signedUrl,
    307,
  );
}
