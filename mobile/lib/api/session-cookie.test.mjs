import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CHUNK_SIZE,
  combineChunks,
  parseCookieHeader,
  stringFromBase64URL,
  stringToBase64URL,
} from "@supabase/ssr";

import { sessionCookie } from "./session-cookie.ts";

/*
 * The phone has no cookie jar, so it builds the session cookie by hand in the
 * shape @supabase/ssr writes on the web -- a format that library owns and has
 * never promised anyone. Every request the app makes depends on the server
 * being able to read it back, and the failure is a blanket 401 with nothing
 * in it that says why.
 *
 * So these tests do not assert against a copy of the format. They assert
 * against the library itself: same chunk size, same base64url, and the
 * library's own reader gets the session back out. The day @supabase/ssr
 * changes any of it, this fails here rather than on somebody's phone.
 */

const NAME = "sb-dvieoqprsmzydtepbxwn-auth-token";

/*
 * The token is deliberately full of "?>" pairs. Plain base64 encodes those to
 * "+" and "/", the two characters base64url replaces -- and a fixture without
 * them lets an encoder that forgot the replacement pass every test here. The
 * first assertion below is the guard on that: it fails if this stops being
 * true rather than letting the rest go quietly green.
 */
const session = {
  access_token: "header.?>?>?>.signature",
  refresh_token: "a-refresh-token",
  expires_at: 1788866846,
  user: { id: "8c6b2f5e-0000-4000-8000-000000000000", email: "a@b.test" },
};

test("the fixture exercises the characters base64url replaces", () => {
  const plain = Buffer.from(JSON.stringify(session), "utf8").toString("base64");

  assert.match(plain, /\+/, "no + in the plain base64, so nothing checks it");
  assert.match(plain, /\//, "no / in the plain base64, so nothing checks it");
});

/** Read a cookie header the way a server does, back into name/value pairs. */
function parsed(header) {
  return new Map(
    parseCookieHeader(header).map((cookie) => [cookie.name, cookie.value]),
  );
}

test("a session that fits is one cookie under the plain name", () => {
  const cookies = parsed(sessionCookie(NAME, session));

  assert.ok(cookies.has(NAME), "the unchunked cookie keeps the bare name");
  assert.equal(cookies.size, 1);
});

test("the encoding is the library's, prefix and all", () => {
  const value = parsed(sessionCookie(NAME, session)).get(NAME);

  assert.equal(
    value,
    `base64-${stringToBase64URL(JSON.stringify(session))}`,
  );
});

test("the library reads its own format back out of what we wrote", async () => {
  const cookies = parsed(sessionCookie(NAME, session));

  const combined = await combineChunks(NAME, (chunk) =>
    cookies.get(chunk) ?? null,
  );

  assert.ok(combined?.startsWith("base64-"), "the prefix survives");

  assert.deepEqual(
    JSON.parse(stringFromBase64URL(combined.slice("base64-".length))),
    session,
  );
});

test("a session too big for one cookie is split at the library's size", async () => {
  /*
   * Real sessions cross this line: a JWT carrying a few custom claims and a
   * long email is comfortably past 3180 base64 characters once encoded.
   */
  const big = {
    ...session,
    access_token: `header.${"p".repeat(4000)}.signature`,
  };

  const cookies = parsed(sessionCookie(NAME, big));

  assert.ok(cookies.size > 1, "it actually chunked");
  assert.ok(!cookies.has(NAME), "no bare name once chunked");

  for (const [name, value] of cookies) {
    assert.match(name, /\.\d+$/, `${name} is numbered`);
    assert.ok(
      value.length <= MAX_CHUNK_SIZE,
      `${name} is ${value.length}, over the ${MAX_CHUNK_SIZE} limit`,
    );
  }

  const combined = await combineChunks(NAME, (chunk) =>
    cookies.get(chunk) ?? null,
  );

  assert.deepEqual(
    JSON.parse(stringFromBase64URL(combined.slice("base64-".length))),
    big,
  );
});

test("chunks are numbered from zero and in order", () => {
  const big = {
    ...session,
    access_token: `header.${"p".repeat(9000)}.signature`,
  };

  const names = [...parsed(sessionCookie(NAME, big)).keys()];

  assert.deepEqual(
    names,
    names.map((_, index) => `${NAME}.${index}`),
  );
});

test("the workspace rides along, escaped", () => {
  const cookies = parsed(
    sessionCookie(NAME, session, "a b/c?d=e"),
  );

  assert.equal(cookies.get("tenh_active_business_id"), "a b/c?d=e");
});

test("no workspace cookie when no workspace was chosen", () => {
  for (const value of [undefined, null, ""]) {
    const cookies = parsed(sessionCookie(NAME, session, value));

    assert.equal(
      cookies.has("tenh_active_business_id"),
      false,
      `workspace ${JSON.stringify(value)} should send nothing`,
    );
  }
});
