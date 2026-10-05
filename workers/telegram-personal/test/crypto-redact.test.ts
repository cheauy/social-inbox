import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  generateDatabaseKey,
  generateSealKeyPair,
  openSealed,
  privateKeyFromPem,
  publicKeyFromRaw,
  seal,
  sealAad,
  unwrapDatabaseKey,
  wrapDatabaseKey,
} from "../src/crypto.ts";
import { maskPhone, redact, redactString } from "../src/redact.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("database key wrap is bound to its session and KEK", () => {
  const kek = randomBytes(32);
  const key = generateDatabaseKey();
  const wrapped = wrapDatabaseKey(kek, A, key);
  assert.ok(!wrapped.includes(key.toString("base64")));
  assert.deepEqual(unwrapDatabaseKey(kek, A, wrapped), key);
  assert.throws(() => unwrapDatabaseKey(kek, B, wrapped), "key copied to another session must not decrypt");
  assert.throws(() => unwrapDatabaseKey(randomBytes(32), A, wrapped), "wrong KEK");
  const tampered = wrapped.slice(0, -2) + (wrapped.endsWith("A") ? "BB" : "AA");
  assert.throws(() => unwrapDatabaseKey(kek, A, tampered));
});

test("sealed login input opens only for the same session and input kind", () => {
  const pair = generateSealKeyPair();
  const pub = publicKeyFromRaw(pair.publicKeyBase64);
  const priv = privateKeyFromPem(pair.privateKeyPem);
  const sealed = seal(pub, sealAad(A, "password"), "correct-horse");
  assert.ok(!sealed.includes("correct-horse"));
  assert.equal(openSealed(priv, sealAad(A, "password"), sealed), "correct-horse");
  assert.throws(() => openSealed(priv, sealAad(B, "password"), sealed), "replay into another tenant's session");
  assert.throws(() => openSealed(priv, sealAad(A, "code"), sealed), "replay as another input kind");
  const other = privateKeyFromPem(generateSealKeyPair().privateKeyPem);
  assert.throws(() => openSealed(other, sealAad(A, "password"), sealed), "another worker key");
});

test("redaction removes QR links, secrets, phone numbers and names", () => {
  const out = JSON.stringify(redact({
    event: "x",
    qrLink: "tg://login?token=SECRET123",
    nested: { password: "pw", phone_number: "85512345678", first_name: "Dara", errorCode: "PHONE_CODE_INVALID" },
    message: "failed for +855 12 345 678 with tg://login?token=ABCDEF",
    wrapped: "v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  }));
  for (const secret of ["SECRET123", "ABCDEF", "pw\"", "85512345678", "12 345 678", "Dara", "AAAAAAAAAAAAAAAA"]) {
    assert.ok(!out.includes(secret), `leaked ${secret}: ${out}`);
  }
  assert.ok(out.includes("PHONE_CODE_INVALID"), "error codes stay visible");
  assert.equal(redactString("tg://login?token=abc"), "tg://login?token=[redacted]");
  assert.equal(maskPhone("85512345678"), "+855 •••• 678");
  assert.equal(maskPhone("12"), "•••");
  assert.equal(maskPhone(null), null);
});
