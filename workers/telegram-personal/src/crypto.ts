import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

/*
 * Two primitives, both AES-256-GCM with associated data that binds the
 * ciphertext to one session, so a value copied between tenants or sessions
 * fails to decrypt instead of being accepted:
 *
 *  - Key wrapping: the per-session TDLib database key is stored in Postgres
 *    wrapped by TELEGRAM_PERSONAL_KEK, which only the worker holds.
 *  - Sealed box (X25519 + HKDF-SHA256 + AES-256-GCM): the web API seals the
 *    phone number / login code / 2FA password to the worker public key. The
 *    database and web tier only ever store ciphertext.
 *
 * The sealed-box format must stay identical to lib/telegram-personal/seal.ts.
 */

const WRAP_PREFIX = "v1.";
const SEAL_PREFIX = "s1.";
const SEAL_INFO = Buffer.from("tenh-tgp-seal-v1", "utf8");

function b64url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function fromB64url(value: string) {
  return Buffer.from(value, "base64url");
}

export function parseKek(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("TELEGRAM_PERSONAL_KEK must be 32 bytes (base64).");
  return key;
}

export function generateDatabaseKey(): Buffer {
  return randomBytes(32);
}

function wrapAad(sessionId: string) {
  return Buffer.from(`tgp-db-key:v1:${sessionId}`, "utf8");
}

export function wrapDatabaseKey(kek: Buffer, sessionId: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  cipher.setAAD(wrapAad(sessionId));
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  return WRAP_PREFIX + b64url(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
}

export function unwrapDatabaseKey(kek: Buffer, sessionId: string, wrapped: string): Buffer {
  if (!wrapped.startsWith(WRAP_PREFIX)) throw new Error("Unsupported wrapped key version.");
  const raw = fromB64url(wrapped.slice(WRAP_PREFIX.length));
  if (raw.length < 12 + 16 + 1) throw new Error("Wrapped key is truncated.");
  const decipher = createDecipheriv("aes-256-gcm", kek, raw.subarray(0, 12));
  decipher.setAAD(wrapAad(sessionId));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

export type LoginInputKind = "phone" | "code" | "password";

export function sealAad(sessionId: string, kind: LoginInputKind) {
  return Buffer.from(`tgp-login:v1:${sessionId}:${kind}`, "utf8");
}

function rawX25519Public(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" });
  if (jwk.crv !== "X25519" || typeof jwk.x !== "string") throw new Error("Expected an X25519 key.");
  return fromB64url(jwk.x);
}

export function publicKeyFromRaw(base64: string): KeyObject {
  const raw = Buffer.from(base64, "base64");
  if (raw.length !== 32) throw new Error("X25519 public key must be 32 bytes.");
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64url(raw) }, format: "jwk" });
}

export function privateKeyFromPem(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "x25519") throw new Error("Seal private key must be X25519.");
  return key;
}

export function generateSealKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKeyBase64: rawX25519Public(publicKey).toString("base64"),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

function sealKey(shared: Buffer, ephemeralPublic: Buffer, recipientPublic: Buffer) {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephemeralPublic, recipientPublic]), SEAL_INFO, 32));
}

/** Used by tests and mirrored by the web API (lib/telegram-personal/seal.ts). */
export function seal(recipientPublic: KeyObject, aad: Buffer, plaintext: string): string {
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralRaw = rawX25519Public(ephemeral.publicKey);
  const recipientRaw = rawX25519Public(recipientPublic);
  const key = sealKey(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientPublic }), ephemeralRaw, recipientRaw);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return SEAL_PREFIX + b64url(Buffer.concat([ephemeralRaw, iv, cipher.getAuthTag(), ciphertext]));
}

export function openSealed(recipientPrivate: KeyObject, aad: Buffer, sealed: string): string {
  if (!sealed.startsWith(SEAL_PREFIX)) throw new Error("Unsupported sealed value version.");
  const raw = fromB64url(sealed.slice(SEAL_PREFIX.length));
  if (raw.length < 32 + 12 + 16 + 1) throw new Error("Sealed value is truncated.");
  const ephemeralRaw = raw.subarray(0, 32);
  const ephemeralPublic = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64url(ephemeralRaw) }, format: "jwk" });
  const recipientRaw = rawX25519Public(createPublicKey(recipientPrivate));
  const key = sealKey(diffieHellman({ privateKey: recipientPrivate, publicKey: ephemeralPublic }), ephemeralRaw, recipientRaw);
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(32, 44));
  decipher.setAAD(aad);
  decipher.setAuthTag(raw.subarray(44, 60));
  return Buffer.concat([decipher.update(raw.subarray(60)), decipher.final()]).toString("utf8");
}
