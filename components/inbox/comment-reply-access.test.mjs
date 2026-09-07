import test from "node:test";
import assert from "node:assert/strict";
import { isCommentReplyBlocked } from "./comment-reply-access.ts";

const root = { id: "r", platform_message_id: "root", comment_is_hidden: false };
const child = { id: "c", platform_message_id: "child", raw_payload: { parent_id: "root" } };
test("visible comments allow replies", () => {
  assert.equal(isCommentReplyBlocked("child", [root, child]), false);
});
test("hidden parent blocks replies to its child", () => {
  assert.equal(isCommentReplyBlocked("child", [{ ...root, comment_is_hidden: true }, child]), true);
});
test("optimistic hide blocks immediately before the server responds", () => {
  assert.equal(isCommentReplyBlocked("child", [root, child], { r: { hidden: true, deleted: false } }), true);
});
test("unhidden parent restores reply access", () => {
  assert.equal(isCommentReplyBlocked("child", [{ ...root, comment_is_hidden: true }, child], { r: { hidden: false, deleted: false } }), false);
});
test("deleted comments cannot receive replies", () => {
  assert.equal(isCommentReplyBlocked("root", [{ ...root, comment_is_deleted: true }]), true);
});
test("parent cycles cannot hang the composer", () => {
  assert.equal(isCommentReplyBlocked("child", [{ ...root, raw_payload: { parent_id: "child" } }, child]), false);
});
