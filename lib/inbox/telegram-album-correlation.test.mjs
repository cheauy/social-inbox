import test from "node:test";
import assert from "node:assert/strict";
import {
  correlateTelegramAlbumMessages,
  telegramAlbumPosition,
} from "./telegram-album-correlation.ts";

const message = (id, requestId, position) => ({
  id,
  conversation_id: "chat",
  platform_message_id: `telegram:chat:${id}`,
  raw_payload: {
    tenh_client_request_id: requestId,
    tenh_media_group: { provider: "telegram", id: "batch", position },
  },
});

test("reverse album response maps to the exact optimistic item", () => {
  const first = message("101", "optimistic:attachment:first", 0);
  const second = message("102", "optimistic:attachment:second", 1);
  assert.deepEqual(
    correlateTelegramAlbumMessages(
      ["optimistic:attachment:first", "optimistic:attachment:second"],
      [second, first],
    ).map(item => item?.id),
    ["101", "102"],
  );
});

test("identical files are not merged without the same exact request id", () => {
  const first = message("101", "optimistic:attachment:first", 0);
  const duplicateBytes = message("102", "optimistic:attachment:second", 1);
  assert.deepEqual(
    correlateTelegramAlbumMessages(
      ["optimistic:attachment:first", "optimistic:attachment:second", "optimistic:attachment:missing"],
      [duplicateBytes, first],
    ).map(item => item?.id),
    ["101", "102", undefined],
  );
  assert.equal(telegramAlbumPosition(first), 0);
  assert.equal(telegramAlbumPosition(duplicateBytes), 1);
});
