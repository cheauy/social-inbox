import "server-only";

import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

/*
 * Seals a login input (phone number, login code or 2FA password) to the
 * Telegram Personal worker's X25519 public key. The web app keeps the
 * plaintext only in memory for this request; Postgres stores ciphertext that
 * only the worker can open, bound to one session and one input kind.
 *
 * Format and derivation must match workers/telegram-personal/src/crypto.ts.
 */

export type TelegramPersonalInputKind = "phone" | "code" | "password";

const SEAL_INFO = Buffer.from("tenh-tgp-seal-v1", "utf8");

function rawPublic(key: KeyObject) {
  const jwk = key.export({ format: "jwk" });
  if (jwk.crv !== "X25519" || typeof jwk.x !== "string") throw new Error("Expected an X25519 key.");
  return Buffer.from(jwk.x, "base64url");
}

export function sealTelegramPersonalInput(
  publicKeyBase64: string,
  sessionId: string,
  kind: TelegramPersonalInputKind,
  plaintext: string,
) {
  const recipientRaw = Buffer.from(publicKeyBase64, "base64");
  if (recipientRaw.length !== 32) throw new Error("Invalid worker public key.");
  const recipient = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: recipientRaw.toString("base64url") }, format: "jwk" });
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralRaw = rawPublic(ephemeral.publicKey);
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephemeralRaw, recipientRaw]), SEAL_INFO, 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`tgp-login:v1:${sessionId}:${kind}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return "s1." + Buffer.concat([ephemeralRaw, iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
