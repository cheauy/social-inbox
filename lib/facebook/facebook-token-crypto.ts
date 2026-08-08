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