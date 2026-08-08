import "server-only";

import {
  decryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";

import {
  supabaseAdmin,
} from "@/lib/supabase/admin";


export async function getFacebookPageAccessToken(
  pageIdInput?: string,
) : Promise<string>{
  const pageId =
    pageIdInput?.trim() ||
    process.env
      .FACEBOOK_PAGE_ID?.trim();

  if (!pageId) {
    throw new Error(
      "Facebook Page ID is missing.",
    );
  }

  const {
    data: socialAccount,
    error,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      is_active,
      facebook_page_access_token_encrypted,
      facebook_token_status
    `)
    .eq(
      "platform",
      "facebook",
    )
    .eq(
      "platform_account_id",
      pageId,
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message,
    );
  }

  if (
    socialAccount
      ?.is_active &&
    socialAccount
      .facebook_page_access_token_encrypted
  ) {
    try {
      return decryptFacebookToken(
        socialAccount
          .facebook_page_access_token_encrypted,
      );
    } catch (error) {
      console.error(
        "Unable to decrypt stored Facebook Page token:",
        error,
      );
    }
  }

  /*
   * Temporary migration fallback.
   *
   * Keep your existing .env token while converting all
   * Facebook API routes to this helper. After everything
   * works through OAuth, remove this fallback.
   */
const legacyToken =
  process.env
    .FACEBOOK_PAGE_ACCESS_TOKEN
    ?.trim();

if (legacyToken) {
  return legacyToken;
}

throw new Error(
  "Facebook is not connected. Reconnect Facebook from Integrations.",
);

 
}