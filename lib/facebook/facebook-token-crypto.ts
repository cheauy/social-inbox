import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";

function getEncryptionKey() {
  const encoded =
    process.env
      .FACEBOOK_TOKEN_ENCRYPTION_KEY;

  if (!encoded) {
    throw new Error(
      "FACEBOOK_TOKEN_ENCRYPTION_KEY is missing.",
    );
  }

  const key =
    Buffer.from(
      encoded,
      "base64",
    );

  if (key.length !== 32) {
    throw new Error(
      "FACEBOOK_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }

  return key;
}

export function encryptFacebookToken(
  token: string,
) {
  const normalized =
    token.trim();

  if (!normalized) {
    throw new Error(
      "Cannot encrypt an empty Facebook token.",
    );
  }

  const key =
    getEncryptionKey();

  const iv =
    randomBytes(12);

  const cipher =
    createCipheriv(
      "aes-256-gcm",
      key,
      iv,
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        normalized,
        "utf8",
      ),
      cipher.final(),
    ]);

  const tag =
    cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString(
      "base64url",
    ),
  ].join(".");
}

export function decryptFacebookToken(
  encryptedValue: string,
) {
  const parts =
    encryptedValue.split(".");

  if (
    parts.length !== 4 ||
    parts[0] !== VERSION
  ) {
    throw new Error(
      "Unsupported encrypted Facebook token format.",
    );
  }

  const [
    ,
    ivEncoded,
    tagEncoded,
    dataEncoded,
  ] = parts;

  const key =
    getEncryptionKey();

  const decipher =
    createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(
        ivEncoded,
        "base64url",
      ),
    );

  decipher.setAuthTag(
    Buffer.from(
      tagEncoded,
      "base64url",
    ),
  );

  const decrypted =
    Buffer.concat([
      decipher.update(
        Buffer.from(
          dataEncoded,
          "base64url",
        ),
      ),
      decipher.final(),
    ]);

  return decrypted.toString(
    "utf8",
  );
}

export type FacebookUserAuthorization = {
  accessToken: string;
  userId: string | null;
};

const FACEBOOK_USER_AUTHORIZATION_ENVELOPE =
  "tenh-facebook-user-authorization-v1";

export function encryptFacebookUserAuthorization({
  accessToken,
  userId,
}: FacebookUserAuthorization) {
  const normalizedToken = accessToken.trim();
  const normalizedUserId = userId?.trim() || null;

  if (!normalizedToken) {
    throw new Error("Cannot encrypt an empty Facebook User authorization.");
  }

  return encryptFacebookToken(
    JSON.stringify({
      type: FACEBOOK_USER_AUTHORIZATION_ENVELOPE,
      accessToken: normalizedToken,
      userId: normalizedUserId,
    }),
  );
}

/**
 * Backward-compatible decoder for facebook_user_access_token_encrypted.
 * Existing rows contain only the raw access token; new rows also keep the
 * app-scoped Facebook user id inside the same AES-GCM encrypted value. This
 * lets TENH match Meta deauthorization callbacks without adding a plaintext
 * identifier or requiring a database migration.
 */
export function decryptFacebookUserAuthorization(
  encryptedValue: string,
): FacebookUserAuthorization {
  const raw = decryptFacebookToken(encryptedValue).trim();

  if (!raw) {
    throw new Error("Stored Facebook User authorization is empty.");
  }

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (
        parsed.type === FACEBOOK_USER_AUTHORIZATION_ENVELOPE &&
        typeof parsed.accessToken === "string" &&
        parsed.accessToken.trim()
      ) {
        return {
          accessToken: parsed.accessToken.trim(),
          userId:
            typeof parsed.userId === "string" && parsed.userId.trim()
              ? parsed.userId.trim()
              : null,
        };
      }
    } catch {
      // Fall through to the legacy raw-token format below.
    }
  }

  return {
    accessToken: raw,
    userId: null,
  };
}
