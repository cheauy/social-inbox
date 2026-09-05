import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

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
  customerId,
  pageAccessToken,
}: {
  contactId: string;
  businessId: string;
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
      { cache: "no-store" },
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
