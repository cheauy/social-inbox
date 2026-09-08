import test from "node:test";
import assert from "node:assert/strict";
import {
  isInternalAnnouncementLink,
  normalizeAnnouncementLink,
} from "./announcement-link.ts";

const BACKSLASH = String.fromCharCode(92);

test("an ordinary path stays relative", () => {
  for (const path of ["/dashboard/inbox", "/", "/a/b?c=d#e"]) {
    assert.equal(isInternalAnnouncementLink(path), true, path);
    assert.equal(normalizeAnnouncementLink(path), path, path);
  }
});

test("a protocol-relative link is neither internal nor allowed", () => {
  // The bug this file exists for: "//evil.com" starts with a slash, so both
  // the API and the banner called it relative, and the banner then skipped
  // the target/rel it gives off-site links.
  for (const path of ["//evil.com", "//evil.com/path", `/${BACKSLASH}evil.com`]) {
    assert.equal(isInternalAnnouncementLink(path), false, path);
    assert.equal(normalizeAnnouncementLink(path), null, path);
  }
});

test("http and https links are kept and marked external", () => {
  for (const url of ["https://tenhchat.com/help", "http://example.com/"]) {
    assert.equal(isInternalAnnouncementLink(url), false, url);
    assert.equal(typeof normalizeAnnouncementLink(url), "string", url);
  }
});

test("any other scheme is refused", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com",
    "mailto:someone@example.com",
  ]) {
    assert.equal(normalizeAnnouncementLink(url), null, url);
  }
});

test("empty and unparseable values are refused", () => {
  for (const value of ["", "   ", "not a url", "http://"]) {
    assert.equal(normalizeAnnouncementLink(value), null, JSON.stringify(value));
  }
});

test("surrounding whitespace is trimmed before the decision", () => {
  assert.equal(normalizeAnnouncementLink("  /dashboard  "), "/dashboard");
  assert.equal(normalizeAnnouncementLink("  //evil.com  "), null);
});

test("a very long link is capped rather than refused", () => {
  const long = `/dashboard/${"a".repeat(900)}`;
  assert.equal(normalizeAnnouncementLink(long).length, 500);
});
