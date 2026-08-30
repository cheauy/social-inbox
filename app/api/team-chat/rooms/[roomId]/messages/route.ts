import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createTeamMentions } from "@/lib/team/create-team-mentions";
import {
  getAccessibleRoom,
  getRoomAudienceMemberIds,
  loadAttachmentsForMessages,
  safeDetails,
} from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ roomId: string }>;
};

function serverError(
  message: string,
  error: unknown,
) {
  console.error(`[Tenh Team Chat V2.11.1] ${message}`, error);

  return NextResponse.json(
    {
      success: false,
      error: message,
      ...safeDetails(
        error instanceof Error ? error.message : undefined,
      ),
    },
    { status: 500 },
  );
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const authResult = await getCurrentMember();

    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: authResult.status },
      );
    }

    const { roomId } = await context.params;
    const currentMember = authResult.member;
    const room = await getAccessibleRoom(
      currentMember,
      roomId,
    );

    if (!room) {
      return NextResponse.json(
        {
          success: false,
          error: "Team chat room not found.",
        },
        { status: 404 },
      );
    }

    const before =
      request.nextUrl.searchParams.get("before");
    const requestedLimit = Number(
      request.nextUrl.searchParams.get("limit") ?? "60",
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 60;

    let query = supabaseAdmin
      .from("team_chat_messages")
      .select(`
        id,
        business_id,
        room_id,
        sender_member_id,
        message_text,
        edited_at,
        created_at,
        updated_at,
        sender:team_members!team_chat_messages_sender_member_id_fkey (
          id,
          full_name,
          email,
          role,
          profile_picture_url
        )
      `)
      .eq("business_id", currentMember.business_id)
      .eq("room_id", room.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt("created_at", before);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to load team messages.",
          ...safeDetails(error.message),
        },
        { status: 500 },
      );
    }

    const ordered = [...(data ?? [])].reverse();

    const attachmentsByMessage = await loadAttachmentsForMessages(
      ordered.map((message) => message.id as string),
    );

    return NextResponse.json({
      success: true,
      room,
      messages: ordered.map((message) => ({
        ...message,
        attachments:
          attachmentsByMessage.get(message.id as string) ?? [],
      })),
      hasMore: (data?.length ?? 0) === limit,
    });
  } catch (error) {
    return serverError(
      "Unable to load team messages.",
      error,
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const authResult = await getCurrentMember();

    if (!authResult.success) {
      return NextResponse.json(
        { success: false, error: authResult.error },
        { status: authResult.status },
      );
    }

    const { roomId } = await context.params;
    const currentMember = authResult.member;
    const room = await getAccessibleRoom(
      currentMember,
      roomId,
    );

    if (!room) {
      return NextResponse.json(
        {
          success: false,
          error: "Team chat room not found.",
        },
        { status: 404 },
      );
    }

    let body: {
      messageText?: string;
      mentionedMemberIds?: string[];
      mentionEveryone?: boolean;
      attachmentIds?: unknown;
    };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON request.",
        },
        { status: 400 },
      );
    }

    const messageText = body.messageText?.trim() ?? "";

    const attachmentIds = Array.isArray(body.attachmentIds)
      ? body.attachmentIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];

    // A message may be text only, attachments only, or both.
    if (!messageText && attachmentIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Message cannot be empty.",
        },
        { status: 400 },
      );
    }

    if (attachmentIds.length > 10) {
      return NextResponse.json(
        {
          success: false,
          error: "You can attach up to 10 files per message.",
        },
        { status: 400 },
      );
    }

    if (messageText.length > 10000) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Message cannot contain more than 10,000 characters.",
        },
        { status: 400 },
      );
    }

    const { data: message, error } =
      await supabaseAdmin
        .from("team_chat_messages")
        .insert({
          business_id: currentMember.business_id,
          room_id: room.id,
          sender_member_id: currentMember.id,
          message_text: messageText,
        })
        .select(`
          id,
          business_id,
          room_id,
          sender_member_id,
          message_text,
          edited_at,
          created_at,
          updated_at,
          sender:team_members!team_chat_messages_sender_member_id_fkey (
            id,
            full_name,
            email,
            role,
            profile_picture_url
          )
        `)
        .single();

    if (error || !message) {
      // Surface the real database reason. The most common cause is a
      // NOT NULL or length CHECK on message_text rejecting an
      // attachment-only message — see
      // supabase/sql/fix-attachment-only-messages.sql
      console.error(
        "[TENH Team Chat] Message insert failed.",
        {
          message: error?.message,
          details: error?.details,
          hint: error?.hint,
          code: error?.code,
          hadText: messageText.length > 0,
          attachmentCount: attachmentIds.length,
        },
      );

      const looksLikeEmptyTextRule =
        !messageText &&
        (error?.code === "23502" || error?.code === "23514");

      return NextResponse.json(
        {
          success: false,
          error: looksLikeEmptyTextRule
            ? "Your database does not allow a message with no text yet. Run supabase/sql/fix-attachment-only-messages.sql to enable attachment-only messages."
            : "Unable to send team message.",
          ...safeDetails(error?.message),
        },
        { status: 500 },
      );
    }

    // Bind uploads to this message. Scoping by room, uploader and
    // message_id is null means a caller cannot steal someone else's
    // upload or re-attach a file that was already sent.
    let attachments: Awaited<
      ReturnType<typeof loadAttachmentsForMessages>
    > extends Map<string, infer V>
      ? V
      : never = [] as never;

    if (attachmentIds.length > 0) {
      const { error: bindError } = await supabaseAdmin
        .from("team_chat_attachments")
        .update({ message_id: message.id })
        .in("id", attachmentIds)
        .eq("business_id", currentMember.business_id)
        .eq("room_id", room.id)
        .eq("uploaded_by_member_id", currentMember.id)
        .is("message_id", null);

      if (bindError) {
        console.error(
          "[TENH Team Chat] Unable to bind attachments.",
          bindError,
        );
      }

      const bound = await loadAttachmentsForMessages([
        message.id as string,
      ]);

      attachments = (bound.get(message.id as string) ?? []) as never;
    }

    let notificationsCreated = 0;

    try {
      // A mention notification carries the message text in its body, so
      // notifying someone who is not in this room would leak a private
      // conversation to a person who cannot open it. Intersect the
      // requested mentions with the room's actual audience, and scope
      // @everyone to the room rather than the whole business.
      const audience = new Set(
        await getRoomAudienceMemberIds(room),
      );

      const requestedMentions = Array.isArray(
        body.mentionedMemberIds,
      )
        ? body.mentionedMemberIds.filter(
            (memberId): memberId is string =>
              typeof memberId === "string",
          )
        : [];

      const scopedMentions = requestedMentions.filter(
        (memberId) => audience.has(memberId),
      );

      const wantsEveryone = body.mentionEveryone === true;

      const mentionTargets = wantsEveryone
        ? Array.from(audience)
        : scopedMentions;

      const mentionResult =
        await createTeamMentions({
          businessId: currentMember.business_id,
          actorMemberId: currentMember.id,
          actorName: currentMember.full_name,
          sourceType: "team_message",
          sourceId: message.id,
          mentionedMemberIds: mentionTargets,
          // Already resolved to this room's audience above. Never let
          // createTeamMentions expand to the whole business.
          mentionEveryone: false,
          roomId: room.id,
          notificationType: "team_chat_mention",
          title: `${currentMember.full_name} mentioned you in #${room.name}`,
          body:
            messageText.slice(0, 500) ||
            `Sent ${attachmentIds.length} attachment${
              attachmentIds.length === 1 ? "" : "s"
            }`,
          link: `/dashboard/group-chat?room=${encodeURIComponent(
            room.id,
          )}`,
        });

      notificationsCreated =
        mentionResult.notificationsCreated;
    } catch (mentionError) {
      console.error(
        "Team message sent, but mentions failed:",
        mentionError,
      );
    }

    await supabaseAdmin
      .from("team_chat_room_members")
      .upsert(
        {
          room_id: room.id,
          business_id: currentMember.business_id,
          member_id: currentMember.id,
          last_read_at: new Date().toISOString(),
        },
        { onConflict: "room_id,member_id" },
      );

    return NextResponse.json({
      success: true,
      message: { ...message, attachments },
      notificationsCreated,
    });
  } catch (error) {
    return serverError(
      "Unable to send team message.",
      error,
    );
  }
}
