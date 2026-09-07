import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_NOTIFICATION_SOUND_KEY,
  getNotificationSound,
  isNotificationSoundKey,
  notificationSounds,
} from "./notification-sounds.ts";

const PUBLIC_DIR = join(process.cwd(), "public");

/*
 * The bug this file exists for: the list named six sounds that had been
 * renamed out of public/alert-sound, so every option in settings was a 404 and
 * the whole feature was silent while still looking like it worked. Nothing
 * failed loudly, because a missing audio file just does not play.
 */
test("every sound in the list is a file that exists", () => {
  for (const sound of notificationSounds) {
    if (!sound.src) continue;

    assert.ok(
      existsSync(join(PUBLIC_DIR, sound.src)),
      `${sound.key} points at a missing file: ${sound.src}`,
    );
  }
});

test("every sound file in the folder is offered", () => {
  const offered = new Set(
    notificationSounds
      .filter((sound) => sound.src)
      .map((sound) => sound.src.split("/").pop()),
  );

  // The mention alert is not a choice in this picker; it belongs to group chat.
  const excluded = new Set(["mentions-notification.mp3"]);

  const missing = readdirSync(join(PUBLIC_DIR, "alert-sound")).filter(
    (file) => !offered.has(file) && !excluded.has(file),
  );

  assert.deepEqual(missing, [], "sound files nobody can choose");
});

test("exactly one silent option, and it is last", () => {
  const silent = notificationSounds.filter((sound) => !sound.src);

  assert.equal(silent.length, 1);
  assert.equal(notificationSounds.at(-1).key, "none");
});

test("keys are unique", () => {
  const keys = notificationSounds.map((sound) => sound.key);

  assert.equal(new Set(keys).size, keys.length);
});

test("the default is real and is the first entry", () => {
  assert.ok(isNotificationSoundKey(DEFAULT_NOTIFICATION_SOUND_KEY));
  assert.equal(notificationSounds[0].key, DEFAULT_NOTIFICATION_SOUND_KEY);
  assert.ok(getNotificationSound(DEFAULT_NOTIFICATION_SOUND_KEY).src);
});

test("a key from the old list falls back to the default, not to silence", () => {
  for (const stale of ["droplet-ping", "crystal-bell", "felted-piano"]) {
    assert.equal(isNotificationSoundKey(stale), false);
    assert.equal(getNotificationSound(stale).key, DEFAULT_NOTIFICATION_SOUND_KEY);
  }
});
