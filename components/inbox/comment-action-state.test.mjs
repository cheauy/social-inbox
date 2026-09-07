import test from "node:test";
import assert from "node:assert/strict";
import { mergeCommentActionState } from "./comment-action-state.ts";

const original = { liked: false, hidden: false, deleted: false, deletedBy: null };
for (const field of ["liked", "hidden", "deleted"]) {
  test(`${field}: stale refreshes cannot undo an in-flight action`, () => {
    const changed = { ...original, [field]: true };
    let state = { comment: changed };
    for (let i = 0; i < 5; i++) {
      state = mergeCommentActionState({ comment: original }, state, new Set(["comment"]));
      assert.deepEqual(state.comment, changed);
    }
    assert.deepEqual(mergeCommentActionState({ comment: changed }, state, new Set()).comment, changed);
  });
}
test("unlike and unhide stay optimistic during refresh", () => {
  const old = { ...original, liked: true, hidden: true };
  assert.deepEqual(mergeCommentActionState({ comment: old }, { comment: original }, new Set(["comment"])).comment, original);
});
test("failed action can roll back and resume server updates", () => {
  const optimistic = { ...original, liked: true };
  assert.deepEqual(mergeCommentActionState({ comment: original }, { comment: optimistic }, new Set()), { comment: original });
});
test("other comments keep receiving live updates", () => {
  const changed = { ...original, hidden: true };
  const result = mergeCommentActionState({ a: original, b: changed }, { a: changed, b: original }, new Set(["a"]));
  assert.deepEqual(result, { a: changed, b: changed });
});
test("pagination does not drop a pending deleted comment", () => {
  const deleted = { ...original, deleted: true, deletedBy: "page" };
  assert.deepEqual(mergeCommentActionState({}, { a: deleted }, new Set(["a"])), { a: deleted });
});
