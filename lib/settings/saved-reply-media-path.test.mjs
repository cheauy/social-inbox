import test from "node:test";
import assert from "node:assert/strict";
import { isPathOwnedByBusiness } from "./saved-reply-media-path.ts";

const MINE = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";

// Written as a char code rather than an escape: "\." inside a template
// literal is just a dot, so the first version of this file asserted against a
// path containing no backslash at all and failed for exactly the right reason.
const BACKSLASH = String.fromCharCode(92);

test("a file under this workspace's own prefix is accepted", () => {
  assert.equal(
    isPathOwnedByBusiness(`saved-replies/${MINE}/photo.jpg`, MINE),
    true,
  );
});

test("another workspace's prefix is refused", () => {
  assert.equal(
    isPathOwnedByBusiness(`saved-replies/${THEIRS}/photo.jpg`, MINE),
    false,
  );
});

test("traversal out of the prefix is refused", () => {
  for (const path of [
    `saved-replies/${MINE}/../${THEIRS}/photo.jpg`,
    `saved-replies/${MINE}/a/../../${THEIRS}/photo.jpg`,
    `saved-replies/${MINE}/./photo.jpg`,
    `saved-replies/${MINE}/..`,
  ]) {
    assert.equal(isPathOwnedByBusiness(path, MINE), false, path);
  }
});

test("empty segments and backslash separators are refused", () => {
  for (const path of [
    `saved-replies/${MINE}//photo.jpg`,
    `saved-replies/${MINE}/`,
    `saved-replies/${MINE}/sub${BACKSLASH}..${BACKSLASH}photo.jpg`,
  ]) {
    assert.equal(isPathOwnedByBusiness(path, MINE), false, path);
  }
});

test("dots inside a file name are ordinary and stay allowed", () => {
  assert.equal(
    isPathOwnedByBusiness(`saved-replies/${MINE}/my..photo.jpg`, MINE),
    true,
  );
});

test("a prefix that only looks like ours is refused", () => {
  // A business id that is a prefix of another one must not match.
  assert.equal(
    isPathOwnedByBusiness(`saved-replies/${MINE}extra/photo.jpg`, MINE),
    false,
  );
  assert.equal(
    isPathOwnedByBusiness(`other-bucket/${MINE}/photo.jpg`, MINE),
    false,
  );
});

test("missing path or business id is refused", () => {
  assert.equal(isPathOwnedByBusiness("", MINE), false);
  assert.equal(isPathOwnedByBusiness(`saved-replies/${MINE}/photo.jpg`, ""), false);
});
