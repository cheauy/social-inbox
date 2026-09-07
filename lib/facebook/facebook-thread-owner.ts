import "server-only";

import { facebookGraphJsonWithTokenRecovery } from "@/lib/facebook/facebook-connection-health";

/*
 * Which app is actually in charge of this Page's messages.
 *
 * Messenger lets several apps sit on one Page, and Meta's Handover Protocol
 * picks one of them as the Primary Receiver. That app gets the `messages`
 * webhooks and holds thread control. Everyone else is a Secondary Receiver:
 * they receive `messaging_standby` instead -- which TENH does not subscribe to
 * -- and any reply they attempt is refused with error #10, "another app is
 * controlling this thread now".
 *
 * The failure is silent and deeply confusing. TENH's own checks all pass: the
 * token is valid, the webhook subscription reports every required field, and
 * Meta returns success when we subscribe. Nothing is broken on our side. The
 * messages simply go somewhere else, so the customer connects a Page, watches
 * an empty inbox, and only learns anything is wrong hours later when a reply
 * fails.
 *
 * A shop switching to TENH from another inbox or chatbot is exactly the
 * customer who hits this, so it is worth naming at connect time rather than
 * leaving them to find Meta's error on their own.
 */

type ThreadOwnerResult =
  | {
      /* Another app holds the thread. Its id, and its name when Meta gives one. */
      controlled: true;
      appId: string;
      appName: string | null;
    }
  | {
      /* Either TENH holds it, or the check could not be completed. */
      controlled: false;
      reason:
        | "owned-by-tenh"
        | "no-conversations"
        | "unavailable";
    };

type ConversationsPayload = {
  data?: Array<{
    participants?: {
      data?: Array<{ id?: string }>;
    };
  }>;
};

type ThreadOwnerPayload = {
  data?: Array<{
    thread_owner?: { app_id?: string };
  }>;
};

type AppPayload = {
  id?: string;
  name?: string;
};

function cleanId(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

export async function detectFacebookThreadOwner({
  pageId,
  accessToken,
}: {
  pageId: string;
  accessToken: string;
}): Promise<ThreadOwnerResult> {
  const ourAppId = cleanId(
    process.env.FACEBOOK_APP_ID,
  );

  /*
   * Without our own app id there is nothing to compare against, and guessing
   * would be worse than staying quiet -- a false "another app is in control"
   * would send the customer to change a Facebook setting for no reason.
   */
  if (!ourAppId) {
    return {
      controlled: false,
      reason: "unavailable",
    };
  }

  try {
    /*
     * thread_owner is asked per conversation, so it needs someone to ask
     * about. Any recent thread answers the question: the Primary Receiver is
     * a Page-level assignment, not a per-thread one.
     */
    const conversations =
      await facebookGraphJsonWithTokenRecovery<ConversationsPayload>({
        pageId,
        path: `${encodeURIComponent(pageId)}/conversations`,
        params: {
          fields: "participants",
          limit: 1,
        },
        accessToken,
      });

    if (!conversations.ok) {
      return {
        controlled: false,
        reason: "unavailable",
      };
    }

    const psid = cleanId(
      conversations.payload?.data?.[0]?.participants?.data?.find(
        (participant) =>
          cleanId(participant.id) &&
          participant.id !== pageId,
      )?.id,
    );

    /*
     * A Page nobody has written to yet cannot be checked. That is not a
     * problem to report -- there is no thread for anyone to control.
     */
    if (!psid) {
      return {
        controlled: false,
        reason: "no-conversations",
      };
    }

    const owner =
      await facebookGraphJsonWithTokenRecovery<ThreadOwnerPayload>({
        pageId,
        path: `${encodeURIComponent(pageId)}/thread_owner`,
        params: { recipient: psid },
        accessToken,
      });

    if (!owner.ok) {
      return {
        controlled: false,
        reason: "unavailable",
      };
    }

    const ownerAppId = cleanId(
      owner.payload?.data?.[0]?.thread_owner?.app_id,
    );

    if (!ownerAppId || ownerAppId === ourAppId) {
      return {
        controlled: false,
        reason: ownerAppId
          ? "owned-by-tenh"
          : "unavailable",
      };
    }

    /*
     * Naming the app turns "something else is in the way" into something the
     * customer can act on -- they usually recognise the tool they used before.
     * The id alone is still useful, so a failure here is not fatal.
     */
    let appName: string | null = null;

    try {
      const app =
        await facebookGraphJsonWithTokenRecovery<AppPayload>({
          pageId,
          path: encodeURIComponent(ownerAppId),
          params: { fields: "name" },
          accessToken,
        });

      appName = app.ok
        ? cleanId(app.payload?.name)
        : null;
    } catch {
      appName = null;
    }

    return {
      controlled: true,
      appId: ownerAppId,
      appName,
    };
  } catch {
    /*
     * Never let this check fail a connection. It is advisory: the Page is
     * connected either way, and a silent skip is better than blocking someone
     * because an extra Graph call did not answer.
     */
    return {
      controlled: false,
      reason: "unavailable",
    };
  }
}

/*
 * The sentence the customer reads. Written as an instruction rather than an
 * error, because there is a specific thing for them to do and Meta's own
 * wording ("another app is controlling this thread now") does not say what.
 */
export function describeThreadOwnerConflict({
  pageName,
  appName,
  khmer,
}: {
  pageName: string;
  appName: string | null;
  khmer: boolean;
}) {
  const other = appName ?? "another app";

  if (khmer) {
    return `${pageName}៖ កម្មវិធីមួយផ្សេងទៀត (${other}) កំពុងគ្រប់គ្រងសាររបស់ Page នេះ ដូច្នេះ TENH មិនអាចទទួល ឬឆ្លើយតបសារបានទេ។ សូមបើក Facebook Page Settings → Messaging → Advanced Messaging → Handover Protocol រួចកំណត់ TENH Chat ជា Primary Receiver។`;
  }

  return `${pageName}: another app (${other}) is currently handling this Page's messages, so TENH cannot receive or reply to them. Open Facebook Page Settings → Messaging → Advanced Messaging → Handover Protocol and set TENH Chat as the Primary Receiver.`;
}
