import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";

export function isMissingFacebookCustomerName(name: string | null | undefined) {
  return !name?.trim() || /^(customer|facebook customer|messenger customer)$/i.test(name.trim());
}

type CustomerNameScope = {
  businessId: string;
  socialAccountId: string;
  contactId: string;
  customerId: string;
};

async function customerNameTarget(scope: CustomerNameScope) {
  const [contact, conversation] = await Promise.all([
    supabaseAdmin.from("contacts").select("id,full_name")
      .eq("id", scope.contactId).eq("business_id", scope.businessId)
      .eq("platform", "facebook").eq("platform_user_id", scope.customerId).maybeSingle(),
    supabaseAdmin.from("conversations").select("id")
      .eq("business_id", scope.businessId).eq("contact_id", scope.contactId)
      .eq("social_account_id", scope.socialAccountId).eq("platform", "facebook").maybeSingle(),
  ]);
  if (contact.error || conversation.error || !contact.data || !conversation.data ||
      !isMissingFacebookCustomerName(contact.data.full_name)) return null;
  return { contact: contact.data, conversation: conversation.data };
}

/** Fill a provider name only while the same scoped contact still has a placeholder. */
export async function saveFacebookCustomerName(scope: CustomerNameScope, fullName: string | null) {
  const name = fullName?.trim();
  if (!name || isMissingFacebookCustomerName(name)) return false;
  try {
    const target = await customerNameTarget(scope);
    if (!target) return false;
    let query = supabaseAdmin.from("contacts").update({ full_name: name, updated_at: new Date().toISOString() })
      .eq("id", scope.contactId).eq("business_id", scope.businessId)
      .eq("platform", "facebook").eq("platform_user_id", scope.customerId);
    query = target.contact.full_name == null ? query.is("full_name", null) : query.eq("full_name", target.contact.full_name);
    const { data, error } = await query.select("id").maybeSingle();
    if (error || !data) return false;
    await createConversationActivity({
      businessId: scope.businessId, conversationId: target.conversation.id, contactId: scope.contactId,
      activityType: "customer_profile_updated", title: "Customer name synced", actorName: "System",
      customerName: name, metadata: { source: "facebook_profile_name", socialAccountId: scope.socialAccountId,
        fullName: name, previousFullName: target.contact.full_name ?? null },
    });
    return true;
  } catch {
    console.warn("[TENH Facebook] Customer name enrichment could not complete; message delivery is unaffected.");
    return false;
  }
}

// Coalesce echo-only lookups and cool down failures for five minutes per server
// instance. Cache only the outcome; never retain Page tokens or provider profiles.
const nameLookups = new Map<string, { until: number; task: Promise<boolean> }>();
export function syncFacebookCustomerName(scope: CustomerNameScope & { pageId: string }) {
  const key = JSON.stringify([scope.businessId, scope.socialAccountId, scope.pageId, scope.contactId, scope.customerId]);
  const existing = nameLookups.get(key);
  if (existing && existing.until > Date.now()) return existing.task;
  const task = (async () => {
    try {
      if (!await customerNameTarget(scope)) return false;
      const pageAccessToken = await getFacebookPageAccessToken(scope.pageId, scope.socialAccountId);
      const profile = await fetchFacebookCustomerProfile({ customerId: scope.customerId, pageAccessToken });
      return profile.ok ? await saveFacebookCustomerName(scope, profile.fullName) : false;
    } catch { return false; }
  })();
  nameLookups.delete(key);
  nameLookups.set(key, { until: Date.now() + 300_000, task });
  while (nameLookups.size > 500) nameLookups.delete(nameLookups.keys().next().value!);
  return task;
}

/* Same default as the rest of the Facebook layer. */
function getGraphVersion() {
  return (
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ||
    "v26.0"
  );
}

/*
 * Messenger customer avatars.
 *
 * Two things went wrong before, and they compound. Avatar discovery only read
 * photos out of payloads TENH already fetched -- conversations, messages,
 * comments -- and Meta does not put a customer photo in any of them, so 423 of
 * 427 Facebook contacts fell back to an initial. The endpoint built for this,
 * the Messenger User Profile API, was never called.
 *
 * And Meta's profile_pic is a short-lived signed URL. Storing the URL gives
 * avatars that work today and break quietly later, which is the likeliest
 * reason the handful of contacts that did have one no longer resolve.
 *
 * So the photo is fetched from the right endpoint and then downloaded into the
 * same bucket the Telegram avatars use, and contacts.profile_picture_url holds
 * a TENH proxy path rather than a Meta URL. That is what makes Telegram work,
 * and there was no reason for Facebook to differ.
 */

export const FACEBOOK_AVATAR_BUCKET =
  "tenh-contact-avatars";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function facebookAvatarStoragePath({
  businessId,
  contactId,
}: {
  businessId: string;
  contactId: string;
}) {
  return `${businessId}/${contactId}/facebook-avatar`;
}

export function facebookAvatarProxyUrl(
  contactId: string,
) {
  return `/api/contacts/${encodeURIComponent(
    contactId,
  )}/facebook-avatar`;
}

type ProfileLookup =
  | {
      ok: true;
      profilePicUrl: string | null;
      fullName: string | null;
    }
  | {
      ok: false;
      error: string;
      /*
       * True when Meta says this id is not reachable through the User Profile
       * API at all -- a comment-only contact has no PSID that endpoint accepts.
       * Retrying that contact will never succeed, so callers can stop.
       */
      permanent: boolean;
    };

/**
 * Ask Meta for a customer's name and photo.
 *
 * This is the Messenger User Profile API, which needs pages_messaging -- the
 * same permission that lets the Page reply at all. It only answers for people
 * who have messaged the Page: a contact known only from a comment has no PSID
 * it accepts, and that is a Meta boundary rather than something to work around.
 */
export async function fetchFacebookCustomerProfile({
  customerId,
  pageAccessToken,
}: {
  customerId: string;
  pageAccessToken: string;
}): Promise<ProfileLookup> {
  const url = new URL(
    `https://graph.facebook.com/${getGraphVersion()}/${encodeURIComponent(
      customerId,
    )}`,
  );

  url.searchParams.set(
    "fields",
    "first_name,last_name,profile_pic",
  );
  url.searchParams.set(
    "access_token",
    pageAccessToken,
  );

  let response: Response;

  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to reach Meta.",
      permanent: false,
    };
  }

  const payload = (await response
    .json()
    .catch(() => null)) as {
    first_name?: unknown;
    last_name?: unknown;
    profile_pic?: unknown;
    error?: {
      message?: string;
      code?: number;
    };
  } | null;

  if (!response.ok || payload?.error) {
    const code = payload?.error?.code;

    return {
      ok: false,
      error:
        payload?.error?.message ??
        `Meta returned ${response.status}.`,
      /*
       * 100 is "Unsupported get request" -- the id is not a PSID this Page can
       * read. 803 is "some of the aliases you requested do not exist". Neither
       * improves on a retry.
       */
      permanent: code === 100 || code === 803,
    };
  }

  const first =
    typeof payload?.first_name === "string"
      ? payload.first_name.trim()
      : "";
  const last =
    typeof payload?.last_name === "string"
      ? payload.last_name.trim()
      : "";
  const fullName =
    [first, last].filter(Boolean).join(" ") ||
    null;

  return {
    ok: true,
    profilePicUrl:
      typeof payload?.profile_pic === "string" &&
      payload.profile_pic.trim()
        ? payload.profile_pic.trim()
        : null,
    fullName,
  };
}

type SyncResult = {
  stored: boolean;
  reason: string;
  permanent: boolean;
};

/**
 * Fetch a customer's photo and keep a copy TENH can serve.
 *
 * Returns rather than throws: this runs inside the webhook path, where a
 * missing avatar must never cost a customer their message.
 */
export async function syncFacebookContactProfilePhoto({
  contactId,
  businessId,
  socialAccountId,
  customerId,
  pageAccessToken,
}: {
  contactId: string;
  businessId: string;
  socialAccountId: string;
  customerId: string;
  pageAccessToken: string;
}): Promise<SyncResult> {
  const profile =
    await fetchFacebookCustomerProfile({
      customerId,
      pageAccessToken,
    });

  if (!profile.ok) {
    return {
      stored: false,
      reason: profile.error,
      permanent: profile.permanent,
    };
  }

  await saveFacebookCustomerName({ businessId, socialAccountId, contactId, customerId }, profile.fullName);

  if (!profile.profilePicUrl) {
    return {
      stored: false,
      reason:
        "Meta returned no profile photo for this customer.",
      /*
       * Not permanent: someone without a photo today may set one, and the
       * lazy path will pick it up the next time they message.
       */
      permanent: false,
    };
  }

  let imageResponse: Response;

  try {
    imageResponse = await fetch(
      profile.profilePicUrl,
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
  } catch (error) {
    return {
      stored: false,
      reason:
        error instanceof Error
          ? error.message
          : "Unable to download the profile photo.",
      permanent: false,
    };
  }

  if (!imageResponse.ok) {
    return {
      stored: false,
      reason: `Photo download returned ${imageResponse.status}.`,
      permanent: false,
    };
  }

  const arrayBuffer =
    await imageResponse.arrayBuffer();

  if (arrayBuffer.byteLength === 0) {
    return {
      stored: false,
      reason: "The downloaded photo was empty.",
      permanent: false,
    };
  }

  if (arrayBuffer.byteLength > MAX_AVATAR_BYTES) {
    return {
      stored: false,
      reason: "The profile photo was larger than 5 MB.",
      permanent: false,
    };
  }

  const contentType =
    imageResponse.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim() || "image/jpeg";

  const storagePath =
    facebookAvatarStoragePath({
      businessId,
      contactId,
    });

  const { error: uploadError } =
    await supabaseAdmin.storage
      .from(FACEBOOK_AVATAR_BUCKET)
      .upload(
        storagePath,
        Buffer.from(arrayBuffer),
        {
          contentType,
          cacheControl: "86400",
          upsert: true,
        },
      );

  if (uploadError) {
    return {
      stored: false,
      reason: uploadError.message,
      permanent: false,
    };
  }

  const { error: contactError } =
    await supabaseAdmin
      .from("contacts")
      .update({
        profile_picture_url:
          facebookAvatarProxyUrl(contactId),
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", contactId)
      .eq("business_id", businessId);

  if (contactError) {
    return {
      stored: false,
      reason: contactError.message,
      permanent: false,
    };
  }

  return {
    stored: true,
    reason: "Saved.",
    permanent: false,
  };
}
