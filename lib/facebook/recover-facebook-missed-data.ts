import "server-only";

import {
  facebookGraphJsonWithTokenRecovery,
} from "@/lib/facebook/facebook-connection-health";
import {
  processFacebookComment,
  type FacebookFeedCommentValue,
} from "@/lib/facebook/process-comment";
import { processFacebookMessage } from "@/lib/facebook/process-message";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  FacebookAttachment,
  FacebookMessagingEvent,
} from "@/types/facebook";

type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
};

type GraphPayload = {
  error?: GraphError;
  [key: string]: unknown;
};

type GraphMessageRef = {
  id?: string;
  created_time?: string;
};

type GraphConversation = {
  id?: string;
  updated_time?: string;
  messages?: {
    data?: GraphMessageRef[];
  };
};

type GraphConversationList = GraphPayload & {
  data?: GraphConversation[];
};

type GraphMessageParticipant = {
  id?: string;
  name?: string;
  username?: string;
};

type GraphAttachment = {
  type?: string;
  mime_type?: string;
  name?: string;
  file_url?: string;
  image_data?: {
    url?: string;
  };
  video_data?: {
    url?: string;
  };
  audio_data?: {
    url?: string;
  };
  payload?: {
    url?: string;
    sticker_id?: number;
  };
};

type GraphMessageDetail = GraphPayload & {
  id?: string;
  created_time?: string;
  from?: GraphMessageParticipant;
  to?: {
    data?: GraphMessageParticipant[];
  };
  message?: string;
  attachments?: {
    data?: GraphAttachment[];
  };
};

type GraphPost = {
  id?: string;
  created_time?: string;
};

type GraphPostList = GraphPayload & {
  data?: GraphPost[];
};

type GraphComment = {
  id?: string;
  message?: string;
  created_time?: string;
  from?: {
    id?: string;
    name?: string;
  };
  parent?: {
    id?: string;
  };
};

type GraphCommentList = GraphPayload & {
  data?: GraphComment[];
};

export type FacebookRecoveryResult = {
  messenger: {
    candidates: number;
    recovered: number;
    failed: number;
  };
  comments: {
    candidates: number;
    recovered: number;
    failed: number;
  };
  tokenRepaired: boolean;
};

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function dateToMs(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toUnixSeconds(value?: string | null) {
  const parsed = dateToMs(value);
  return parsed === null
    ? Math.floor(Date.now() / 1000)
    : Math.floor(parsed / 1000);
}

function clampLookbackMinutes(value?: number) {
  if (!Number.isFinite(value)) {
    return 180;
  }

  return Math.min(1440, Math.max(60, Math.round(value as number)));
}

function normalizeGraphAttachment(
  attachment: GraphAttachment,
): FacebookAttachment | null {
  const directType = cleanString(attachment.type)?.toLowerCase();
  const mime = cleanString(attachment.mime_type)?.toLowerCase();
  const imageUrl = cleanString(attachment.image_data?.url);
  const videoUrl = cleanString(attachment.video_data?.url);
  const audioUrl = cleanString(attachment.audio_data?.url);
  const fileUrl = cleanString(attachment.file_url);
  const payloadUrl = cleanString(attachment.payload?.url);

  if (imageUrl || directType === "image" || mime?.startsWith("image/")) {
    return {
      type: "image",
      payload: {
        url: imageUrl ?? payloadUrl ?? fileUrl ?? undefined,
        sticker_id: attachment.payload?.sticker_id,
      },
    };
  }

  if (videoUrl || directType === "video" || mime?.startsWith("video/")) {
    return {
      type: "video",
      payload: {
        url: videoUrl ?? payloadUrl ?? fileUrl ?? undefined,
      },
    };
  }

  if (audioUrl || directType === "audio" || mime?.startsWith("audio/")) {
    return {
      type: "audio",
      payload: {
        url: audioUrl ?? payloadUrl ?? fileUrl ?? undefined,
      },
    };
  }

  if (fileUrl || payloadUrl || directType === "file") {
    return {
      type: "file",
      payload: {
        url: fileUrl ?? payloadUrl ?? undefined,
      },
    };
  }

  return null;
}

async function loadExistingPlatformMessageIds(ids: string[]) {
  if (ids.length === 0) {
    return new Set<string>();
  }

  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("platform_message_id")
    .in("platform_message_id", ids);

  if (error) {
    throw new Error(
      `Unable to compare recovered Facebook message IDs: ${error.message}`,
    );
  }

  return new Set(
    (data ?? [])
      .map((row) => cleanString(row.platform_message_id))
      .filter((id): id is string => Boolean(id)),
  );
}

async function recoverMessenger({
  pageId,
  accessToken,
  cutoffMs,
}: {
  pageId: string;
  accessToken: string;
  cutoffMs: number;
}) {
  let token = accessToken;
  let tokenRepaired = false;

  const conversations =
    await facebookGraphJsonWithTokenRecovery<GraphConversationList>({
      pageId,
      path: `${encodeURIComponent(pageId)}/conversations`,
      params: {
        fields: "id,updated_time,messages.limit(20){id,created_time}",
        limit: 20,
      },
      accessToken: token,
    });

  token = conversations.accessToken;
  tokenRepaired = tokenRepaired || conversations.tokenRepaired;

  if (!conversations.ok) {
    throw new Error(
      conversations.payload.error?.message ??
        `Unable to list recent Messenger conversations (HTTP ${conversations.status}).`,
    );
  }

  const refs = new Map<string, GraphMessageRef>();

  for (const conversation of conversations.payload.data ?? []) {
    const updatedMs = dateToMs(conversation.updated_time);

    if (updatedMs !== null && updatedMs < cutoffMs) {
      continue;
    }

    for (const message of conversation.messages?.data ?? []) {
      const id = cleanString(message.id);
      const createdMs = dateToMs(message.created_time);

      if (!id || (createdMs !== null && createdMs < cutoffMs)) {
        continue;
      }

      refs.set(id, message);
      if (refs.size >= 80) {
        break;
      }
    }

    if (refs.size >= 80) {
      break;
    }
  }

  const candidateIds = Array.from(refs.keys());
  const existing = await loadExistingPlatformMessageIds(candidateIds);
  const missingIds = candidateIds.filter((id) => !existing.has(id));

  let recovered = 0;
  let failed = 0;

  // Fetch details only for IDs TENH does not already have. This keeps the
  // hourly recovery bounded and avoids unnecessary Graph calls.
  for (const messageId of missingIds.slice(0, 60)) {
    try {
      let detail =
        await facebookGraphJsonWithTokenRecovery<GraphMessageDetail>({
          pageId,
          path: encodeURIComponent(messageId),
          params: {
            fields: "id,created_time,from,to,message,attachments",
          },
          accessToken: token,
        });

      token = detail.accessToken;
      tokenRepaired = tokenRepaired || detail.tokenRepaired;

      // Some Graph versions/account types do not expose attachments on the
      // message details edge. Retry with Meta's documented core fields instead
      // of dropping the message entirely.
      if (!detail.ok && detail.payload.error?.code === 100) {
        detail = await facebookGraphJsonWithTokenRecovery<GraphMessageDetail>({
          pageId,
          path: encodeURIComponent(messageId),
          params: {
            fields: "id,created_time,from,to,message",
          },
          accessToken: token,
        });
        token = detail.accessToken;
        tokenRepaired = tokenRepaired || detail.tokenRepaired;
      }

      if (!detail.ok) {
        failed += 1;
        continue;
      }

      const fromId = cleanString(detail.payload.from?.id);
      const recipients = (detail.payload.to?.data ?? [])
        .map((item) => cleanString(item.id))
        .filter((id): id is string => Boolean(id));
      const isEcho = fromId === pageId;
      const customerId = isEcho
        ? recipients.find((id) => id !== pageId) ?? null
        : fromId;

      if (!fromId || !customerId) {
        failed += 1;
        continue;
      }

      const attachments = (detail.payload.attachments?.data ?? [])
        .map(normalizeGraphAttachment)
        .filter((item): item is FacebookAttachment => Boolean(item));
      const text = cleanString(detail.payload.message);
      const createdMs = dateToMs(detail.payload.created_time) ?? Date.now();

      if (createdMs < cutoffMs) {
        continue;
      }

      const event: FacebookMessagingEvent = {
        sender: {
          id: fromId,
        },
        recipient: {
          id: isEcho ? customerId : pageId,
        },
        timestamp: createdMs,
        message: {
          mid: messageId,
          is_echo: isEcho,
          text:
            text ??
            (attachments.length === 0
              ? "[Recovered Messenger message]"
              : undefined),
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      };

      await processFacebookMessage(event);
      recovered += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        "[TENH Facebook Recovery] Unable to recover Messenger message:",
        {
          pageId,
          messageId,
          error:
            error instanceof Error ? error.message : "Unknown error",
        },
      );
    }
  }

  return {
    candidates: missingIds.length,
    recovered,
    failed,
    accessToken: token,
    tokenRepaired,
  };
}

async function loadKnownPostIds({
  socialAccountId,
}: {
  socialAccountId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("facebook_post_id")
    .eq("social_account_id", socialAccountId)
    .not("facebook_post_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(80);

  if (error) {
    console.warn(
      "[TENH Facebook Recovery] Unable to load known Facebook post IDs:",
      error.message,
    );
    return [] as string[];
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => cleanString(row.facebook_post_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
}

async function recoverComments({
  pageId,
  socialAccountId,
  accessToken,
  cutoffMs,
}: {
  pageId: string;
  socialAccountId: string;
  accessToken: string;
  cutoffMs: number;
}) {
  let token = accessToken;
  let tokenRepaired = false;

  const posts = await facebookGraphJsonWithTokenRecovery<GraphPostList>({
    pageId,
    path: `${encodeURIComponent(pageId)}/feed`,
    params: {
      fields: "id,created_time",
      limit: 20,
    },
    accessToken: token,
  });

  token = posts.accessToken;
  tokenRepaired = tokenRepaired || posts.tokenRepaired;

  if (!posts.ok) {
    throw new Error(
      posts.payload.error?.message ??
        `Unable to list Facebook Page posts for recovery (HTTP ${posts.status}).`,
    );
  }

  const knownPostIds = await loadKnownPostIds({
    socialAccountId,
  });
  const postIds = Array.from(
    new Set([
      ...(posts.payload.data ?? [])
        .map((post) => cleanString(post.id))
        .filter((id): id is string => Boolean(id)),
      ...knownPostIds,
    ]),
  ).slice(0, 50);

  let candidates = 0;
  let recovered = 0;
  let failed = 0;
  const cutoffSeconds = Math.floor(cutoffMs / 1000);

  for (const postId of postIds) {
    try {
      let comments =
        await facebookGraphJsonWithTokenRecovery<GraphCommentList>({
          pageId,
          path: `${encodeURIComponent(postId)}/comments`,
          params: {
            fields: "id,message,from{id,name},created_time,parent{id}",
            filter: "stream",
            limit: 100,
            since: cutoffSeconds,
          },
          accessToken: token,
        });

      token = comments.accessToken;
      tokenRepaired = tokenRepaired || comments.tokenRepaired;

      // Keep recovery compatible if a Graph version rejects `since` on this
      // specific comments edge. The client-side cutoff below still prevents
      // old comments from being imported as part of the hourly safety pass.
      if (!comments.ok && comments.payload.error?.code === 100) {
        comments = await facebookGraphJsonWithTokenRecovery<GraphCommentList>({
          pageId,
          path: `${encodeURIComponent(postId)}/comments`,
          params: {
            fields: "id,message,from{id,name},created_time,parent{id}",
            filter: "stream",
            limit: 100,
          },
          accessToken: token,
        });
        token = comments.accessToken;
        tokenRepaired = tokenRepaired || comments.tokenRepaired;
      }

      if (!comments.ok) {
        failed += 1;
        continue;
      }

      const recentComments = (comments.payload.data ?? []).filter((comment) => {
        const createdMs = dateToMs(comment.created_time);
        return createdMs === null || createdMs >= cutoffMs;
      });
      const ids = recentComments
        .map((comment) => cleanString(comment.id))
        .filter((id): id is string => Boolean(id));
      const existing = await loadExistingPlatformMessageIds(ids);

      for (const comment of recentComments) {
        const commentId = cleanString(comment.id);

        if (!commentId || existing.has(commentId)) {
          continue;
        }

        candidates += 1;

        if (candidates > 120) {
          break;
        }

        const value: FacebookFeedCommentValue = {
          item: "comment",
          verb: "add",
          comment_id: commentId,
          post_id: postId,
          parent_id: cleanString(comment.parent?.id) ?? postId,
          message: comment.message ?? "",
          created_time: toUnixSeconds(comment.created_time),
          from:
            cleanString(comment.from?.id) || cleanString(comment.from?.name)
              ? {
                  id: cleanString(comment.from?.id) ?? "",
                  name: cleanString(comment.from?.name) ?? "Facebook User",
                }
              : undefined,
        };

        try {
          await processFacebookComment({
            pageId,
            value,
          });
          recovered += 1;
        } catch (error) {
          failed += 1;
          console.warn(
            "[TENH Facebook Recovery] Unable to recover Facebook comment:",
            {
              pageId,
              postId,
              commentId,
              error:
                error instanceof Error ? error.message : "Unknown error",
            },
          );
        }
      }
    } catch (error) {
      failed += 1;
      console.warn(
        "[TENH Facebook Recovery] Unable to inspect post comments:",
        {
          pageId,
          postId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
    }

    if (candidates > 120) {
      break;
    }
  }

  return {
    candidates,
    recovered,
    failed,
    accessToken: token,
    tokenRepaired,
  };
}

/**
 * Bounded recovery pass used by the Facebook watchdog after a health check.
 * Re-scans a short recent window and inserts only platform IDs missing from
 * TENH, so running it every hour is idempotent and protects against temporary
 * webhook gaps without duplicating conversations/messages/comments.
 */
export async function recoverRecentFacebookData({
  pageId,
  socialAccountId,
  accessToken,
  lookbackMinutes,
}: {
  pageId: string;
  socialAccountId: string;
  accessToken: string;
  lookbackMinutes?: number;
}): Promise<FacebookRecoveryResult> {
  const lookback = clampLookbackMinutes(lookbackMinutes);
  const cutoffMs = Date.now() - lookback * 60_000;

  let messenger = {
    candidates: 0,
    recovered: 0,
    failed: 0,
    accessToken,
    tokenRepaired: false,
  };

  try {
    messenger = await recoverMessenger({
      pageId,
      accessToken,
      cutoffMs,
    });
  } catch (error) {
    messenger.failed += 1;
    console.warn(
      "[TENH Facebook Recovery] Messenger recovery pass failed:",
      {
        pageId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    );
  }

  let comments = {
    candidates: 0,
    recovered: 0,
    failed: 0,
    accessToken: messenger.accessToken,
    tokenRepaired: false,
  };

  try {
    comments = await recoverComments({
      pageId,
      socialAccountId,
      accessToken: messenger.accessToken,
      cutoffMs,
    });
  } catch (error) {
    comments.failed += 1;
    console.warn(
      "[TENH Facebook Recovery] Comment recovery pass failed:",
      {
        pageId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    );
  }

  return {
    messenger: {
      candidates: messenger.candidates,
      recovered: messenger.recovered,
      failed: messenger.failed,
    },
    comments: {
      candidates: comments.candidates,
      recovered: comments.recovered,
      failed: comments.failed,
    },
    tokenRepaired: messenger.tokenRepaired || comments.tokenRepaired,
  };
}
