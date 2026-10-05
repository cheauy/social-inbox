import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { canSeePersonalAccount, personalAccountFromContact, PERSONAL_PLATFORM } from "@/lib/telegram-personal/visibility";

type CreateTeamMentionsInput = {
  businessId: string;
  actorMemberId: string;
  actorName: string;
  sourceType: "team_message" | "contact_note";
  sourceId: string;
  mentionedMemberIds?: string[];
  mentionEveryone?: boolean;
  roomId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  notificationType: string;
  title: string;
  body?: string | null;
  link?: string | null;
};

function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

/** The Telegram Personal account behind a conversation or contact, if any. */
async function personalAccountFor({ businessId, conversationId, contactId }: { businessId: string; conversationId: string | null; contactId: string | null }) {
  if (conversationId) {
    const { data } = await supabaseAdmin.from("conversations").select("platform,social_account_id")
      .eq("id", conversationId).eq("business_id", businessId).maybeSingle();
    if (data?.platform === PERSONAL_PLATFORM) return String(data.social_account_id);
  }
  if (contactId) {
    const { data } = await supabaseAdmin.from("contacts").select("platform,platform_user_id")
      .eq("id", contactId).eq("business_id", businessId).maybeSingle();
    if (data) return personalAccountFromContact(data);
  }
  return null;
}

export async function createTeamMentions({
  businessId,
  actorMemberId,
  actorName,
  sourceType,
  sourceId,
  mentionedMemberIds = [],
  mentionEveryone = false,
  roomId = null,
  contactId = null,
  conversationId = null,
  notificationType,
  title,
  body = null,
  link = null,
}: CreateTeamMentionsInput) {
  let targetIds = uniqueStrings(mentionedMemberIds);

  if (mentionEveryone) {
    const { data: members, error: membersError } =
      await supabaseAdmin
        .from("team_members")
        .select("id")
        .eq("business_id", businessId)
        .eq("is_active", true);

    if (membersError) {
      throw new Error(
        `Unable to resolve @everyone: ${membersError.message}`,
      );
    }

    targetIds = uniqueStrings([
      ...targetIds,
      ...(members ?? []).map((member) => member.id),
    ]);
  }

  targetIds = targetIds.filter(
    (memberId) => memberId !== actorMemberId,
  );

  if (targetIds.length === 0) {
    return {
      mentionedMemberIds: [] as string[],
      notificationsCreated: 0,
    };
  }

  const { data: validMembers, error: validError } =
    await supabaseAdmin
      .from("team_members")
      .select("id,user_id")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .in("id", targetIds);

  if (validError) {
    throw new Error(
      `Unable to validate mentioned team members: ${validError.message}`,
    );
  }

  // On a Telegram Personal chat, only teammates allowed to see it are notified
  // (notification rows reach browsers through Realtime with their text).
  const personalAccount = await personalAccountFor({ businessId, conversationId, contactId });
  const allowedMembers: Array<{ id: string; user_id: string | null }> = [];
  for (const member of (validMembers ?? []) as Array<{ id: string; user_id: string | null }>) {
    if (personalAccount && !(await canSeePersonalAccount(personalAccount, String(member.user_id ?? "")))) continue;
    allowedMembers.push(member);
  }

  const validIds = uniqueStrings(
    allowedMembers.map((member) => member.id),
  );

  if (validIds.length === 0) {
    return {
      mentionedMemberIds: [] as string[],
      notificationsCreated: 0,
    };
  }

  const mentionRows = validIds.map((memberId) => ({
    business_id: businessId,
    source_type: sourceType,
    source_id: sourceId,
    room_id: roomId,
    contact_id: contactId,
    conversation_id: conversationId,
    mentioned_member_id: memberId,
    created_by: actorMemberId,
  }));

  const { error: mentionError } = await supabaseAdmin
    .from("team_mentions")
    .upsert(mentionRows, {
      onConflict:
        "source_type,source_id,mentioned_member_id",
      ignoreDuplicates: true,
    });

  if (mentionError) {
    throw new Error(
      `Unable to record mentions: ${mentionError.message}`,
    );
  }

  const notificationRows = validIds.map((memberId) => ({
    business_id: businessId,
    recipient_member_id: memberId,
    actor_member_id: actorMemberId,
    notification_type: notificationType,
    title,
    body:
      body ?? `${actorName} mentioned you.`,
    link,
    room_id: roomId,
    conversation_id: conversationId,
    contact_id: contactId,
  }));

  const { error: notificationError } =
    await supabaseAdmin
      .from("team_notifications")
      .insert(notificationRows);

  if (notificationError) {
    throw new Error(
      `Unable to create mention notifications: ${notificationError.message}`,
    );
  }

  return {
    mentionedMemberIds: validIds,
    notificationsCreated: validIds.length,
  };
}
