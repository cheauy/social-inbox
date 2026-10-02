const test = require("node:test");
const assert = require("node:assert/strict");

const {
  database,
  loader,
} = require("./tenh-seven/harness.cjs");

function telegramSeed() {
  return {
    conversations: [
      {
        id: "conv1",
        business_id: "b1",
        contact_id: "contact1",
        social_account_id: "bot1",
        platform: "telegram",
        last_message_at: "2026-10-02T00:00:00.000Z",
      },
    ],
    contacts: [
      {
        id: "contact1",
        business_id: "b1",
        platform: "telegram",
        platform_user_id: "72595",
      },
    ],
    social_accounts: [
      {
        id: "bot1",
        business_id: "b1",
        platform: "telegram",
        platform_account_id: "tenh-test-bot",
        is_active: true,
        telegram_token_status: "verified",
        telegram_bot_token_encrypted: "encrypted-test-token",
      },
    ],
    messages: [],
  };
}

function createRouteHarness() {
  const db = database(telegramSeed());
  const sends = {
    groups: [],
    photos: [],
    videos: [],
  };
  const saves = [];
  const deletes = [];
  const member = {
    id: "member1",
    business_id: "b1",
  };

  const load = loader({
    "@/lib/supabase/admin": {
      supabaseAdmin: db,
    },
    "@/lib/inbox/get-inbox-resource-access": {
      getInboxConversationAccess: async () => ({
        success: true,
        member,
      }),
    },
    "@/lib/auth/require-permission": {
      memberHasPermission: async () => true,
      permissionDenied: () => Response.json(
        { success: false },
        { status: 403 },
      ),
    },
    "@/lib/channels/channel-token-crypto": {
      decryptChannelCredential: () => "test-token",
    },
    "@/lib/telegram/telegram-api": {
      sendTelegramMediaGroup: async (input) => {
        sends.groups.push(input);
        return input.files.map((file, index) => ({
          message_id: 80 + index,
          date: 1790899200 + index,
          from: { id: 123 },
          ...(file.type === "video/mp4"
            ? { video: { file_id: `provider-video-${index}` } }
            : { photo: [{ file_id: `provider-photo-${index}` }] }),
        }));
      },
      sendTelegramPhoto: async (input) => {
        sends.photos.push(input);
        return {
          message_id: 76,
          date: 1790899199,
          from: { id: 123 },
          photo: [{ file_id: "provider-photo" }],
        };
      },
      sendTelegramVideo: async (input) => {
        sends.videos.push(input);
        return {
          message_id: 77,
          date: 1790899200,
          from: { id: 123 },
          video: { file_id: "provider-video" },
        };
      },
    },
    "@/lib/telegram/telegram-message-media": {
      TENH_TELEGRAM_OUTGOING_PHOTO_MAX_BYTES: 4 * 1024 * 1024,
      inferTelegramPhotoContentType: ({ providedContentType }) =>
        providedContentType,
      inferTelegramVideoContentType: () => "video/mp4",
      saveTelegramMessageMedia: async (input) => {
        saves.push(input);
        return {
          attachmentUrl: `/api/messages/${input.messageId}/media`,
        };
      },
      deleteTelegramMessageMedia: async (input) => {
        deletes.push(input);
      },
    },
  }, {
    File,
    FormData,
  });

  return {
    db,
    deletes,
    load,
    saves,
    sends,
  };
}

async function postFiles(harness, files) {
  const form = new FormData();
  form.set("conversationId", "conv1");

  if (files.length === 1) {
    form.set("file", files[0]);
  } else {
    for (const file of files) {
      form.append("files", file);
    }
  }

  const response = await harness.load(
    "app/api/telegram/send-photo/route.ts",
  ).POST(new Request("https://fixture.test/send", {
    method: "POST",
    body: form,
  }));

  return {
    body: await response.json(),
    response,
  };
}

const fixtureFile = (name, type) =>
  new File(
    [new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])],
    name,
    { type },
  );

test("a single Telegram MP4 is sent and persisted as playable video media", async () => {
  const harness = createRouteHarness();
  const {
    db,
    deletes,
    saves,
    sends,
  } = harness;

  const { body, response } = await postFiles(
    harness,
    [fixtureFile("clip.mp4", "video/mp4")],
  );

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(sends.videos.length, 1);
  assert.equal(sends.photos.length, 0);
  assert.equal(sends.groups.length, 0);
  assert.equal(sends.videos[0].video.type, "video/mp4");
  assert.equal(saves.length, 1);
  assert.equal(saves[0].contentType, "video/mp4");
  assert.equal(saves[0].mediaKind, "video");
  assert.equal(deletes.length, 0);

  const stored = db.tables.messages[0];
  assert.equal(stored.message_type, "video");
  assert.equal(stored.message_text, "Sent a video");
  assert.equal(stored.raw_payload.tenh_attachment.type, "video");
  assert.equal(stored.raw_payload.tenh_attachment.mime_type, "video/mp4");
  assert.match(stored.attachment_url, /\/api\/messages\/.+\/media/);
  assert.equal(
    db.tables.conversations[0].last_message_text,
    "You sent a video",
  );
});

test("a single Telegram photo keeps photo transport and storage semantics", async () => {
  const harness = createRouteHarness();
  const { body, response } = await postFiles(
    harness,
    [fixtureFile("photo.png", "image/png")],
  );

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(harness.sends.photos.length, 1);
  assert.equal(harness.sends.videos.length, 0);
  assert.equal(harness.sends.groups.length, 0);
  assert.equal(harness.saves[0].mediaKind, "photo");
  assert.equal(harness.saves[0].contentType, "image/png");
  assert.equal(harness.db.tables.messages[0].message_type, "image");
  assert.equal(
    harness.db.tables.messages[0].raw_payload.tenh_attachment.type,
    "image",
  );
  assert.equal(
    harness.db.tables.conversations[0].last_message_text,
    "You sent a photo",
  );
});

test("a mixed Telegram album persists each item under its matching media kind", async () => {
  const harness = createRouteHarness();
  const { body, response } = await postFiles(
    harness,
    [
      fixtureFile("photo.jpg", "image/jpeg"),
      fixtureFile("clip.mp4", "video/mp4"),
    ],
  );

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(harness.sends.groups.length, 1);
  assert.equal(harness.sends.photos.length, 0);
  assert.equal(harness.sends.videos.length, 0);
  assert.deepEqual(
    Array.from(harness.saves, ({ mediaKind, contentType }) => ({
      mediaKind,
      contentType,
    })),
    [
      { mediaKind: "photo", contentType: "image/jpeg" },
      { mediaKind: "video", contentType: "video/mp4" },
    ],
  );
  assert.deepEqual(
    Array.from(harness.db.tables.messages, (message) => message.message_type),
    ["image", "video"],
  );
  assert.equal(
    harness.db.tables.conversations[0].last_message_text,
    "You sent a video",
  );
});
