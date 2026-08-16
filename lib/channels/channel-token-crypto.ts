import "server-only";

import {
  decryptFacebookToken,
  encryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";

/**
 * V3.11.2 compatibility wrapper.
 *
 * TENH already has a deployed AES-256-GCM credential key through the existing
 * Facebook token crypto helper. Reuse that same server-only encryption boundary
 * for Telegram instead of introducing a second key that could drift between
 * local/Vercel environments.
 *
 * A later credential migration can rename the environment variable without
 * changing the encrypted-value format.
 */
export function encryptChannelCredential(
  value: string,
) {
  return encryptFacebookToken(value);
}

export function decryptChannelCredential(
  encryptedValue: string,
) {
  return decryptFacebookToken(
    encryptedValue,
  );
}
