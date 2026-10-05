import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../app/review/tiktok/page.tsx", import.meta.url);
const prototypePath = new URL("../app/review/tiktok/tiktok-review-prototype.tsx", import.meta.url);

test("TikTok review route fails closed outside development", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /process\.env\.NODE_ENV !== "development"/);
  assert.match(source, /notFound\(\)/);
});

test("prototype is explicitly synthetic and contains no provider calls", async () => {
  const source = await readFile(prototypePath, "utf8");
  assert.match(source, /Prototype — TikTok API access pending/);
  assert.match(source, /Synthetic data only/);
  assert.match(source, /Direct messaging is future scope/);
  assert.doesNotMatch(source, /fetch\(|axios|supabase|oauth|access_token/i);
});

test("recording flow exposes connect, account, management, close, and reset actions", async () => {
  const source = await readFile(prototypePath, "utf8");
  for (const label of ["Simulate Connect TikTok", "Choose a merchant account", "Owned videos", "Reply", "Hide comment", "Delete comment", "Close connection", "Reset demo"]) {
    assert.ok(source.includes(label), `missing review action: ${label}`);
  }
});
