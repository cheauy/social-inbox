import test from "node:test";
import assert from "node:assert/strict";
import { isTransientRealtimeError } from "./realtime-error.ts";

test("the 1006 close the dev overlay was shouting about is transient", () => {
  assert.equal(
    isTransientRealtimeError(new Error("socket closed: 1006")),
    true,
  );
});

test("the other codes a socket closes itself with are transient", () => {
  for (const code of [1000, 1001, 1005, 1012, 1013]) {
    assert.equal(
      isTransientRealtimeError(new Error(`socket closed: ${code}`)),
      true,
      `close code ${code}`,
    );
  }
});

test("a close carrying no code is still a close", () => {
  assert.equal(isTransientRealtimeError(new Error("socket closed")), true);
});

test("a protocol or policy close is not transient", () => {
  for (const code of [1002, 1003, 1008, 1011]) {
    assert.equal(
      isTransientRealtimeError(new Error(`socket closed: ${code}`)),
      false,
      `close code ${code}`,
    );
  }
});

test("a real channel failure keeps its console.error", () => {
  for (const message of [
    "Unable to subscribe to changes with given parameters",
    "RLS policy denies access to table messages",
    "token has expired",
  ]) {
    assert.equal(isTransientRealtimeError(new Error(message)), false, message);
  }
});

test("supabase hands the callback a string sometimes, and nothing others", () => {
  assert.equal(isTransientRealtimeError("socket closed: 1006"), true);
  assert.equal(isTransientRealtimeError(undefined), false);
  assert.equal(isTransientRealtimeError(null), false);
  assert.equal(isTransientRealtimeError({}), false);
  assert.equal(isTransientRealtimeError(new Error("")), false);
});
