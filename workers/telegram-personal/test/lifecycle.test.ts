import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import test from "node:test";
import { acquireDirectoryLock, ensureSessionDirectory, LockHeldError, sessionDirectory } from "../src/local-data.ts";
import { makeHarness, waitFor } from "./helpers/harness.ts";
import type { FakeUser } from "./helpers/fake-telegram.ts";
import type { MemoryStore } from "./helpers/memory-store.ts";

const OWNER: FakeUser = { id: 5550001, firstName: "Fake Owner", phone: "85512345678" };
const OWNER_2FA: FakeUser = { ...OWNER, password: "correct-horse" };

type H = ReturnType<typeof makeHarness<MemoryStore>>;

function client(h: H, sessionId: string) {
  const c = h.telegram.clientFor(sessionDirectory(h.dataDir, sessionId).database);
  assert.ok(c, "client exists");
  return c;
}

function noSecretsLogged(h: H) {
  const text = h.logs.join("\n");
  for (const secret of ["FAKEQR", "SECRET", "correct-horse", "12345678", "85512345678", "Fake Owner", "fakeowner"]) {
    assert.ok(!text.includes(secret), `log leaked ${secret}`);
  }
}

async function qrLogin(h: H, user: FakeUser = OWNER, business = "biz-1") {
  const id = h.store.beginLogin(business, "qr");
  await h.supervisor.tick();
  await waitFor(() => h.store.logins.get(id)?.qrLink != null, 2000, "QR link");
  client(h, id).approveQr(user);
  return id;
}

test("QR login: per-session key and directory, QR stored only while open, connected identity", async () => {
  const h = makeHarness();
  try {
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "connected", 2000, "connected");
    const row = h.store.rows.get(id)!;
    assert.equal(row.telegramUserId, "5550001");
    assert.equal(row.channelActive, true);
    assert.ok(row.dbKeyWrapped?.startsWith("v1."));
    assert.equal(row.localState, "present");
    assert.equal(h.store.logins.has(id), false, "QR link and login state removed after login");
    const identity = h.store.writes.find((w) => w.op === "activate")?.patch as { phoneMasked: string };
    assert.equal(identity.phoneMasked, "+855 •••• 678");
    const offline = client(h, id).requests.find((r) => r._ === "setOption");
    assert.deepEqual(offline?.value, { _: "optionValueBoolean", value: false }, "never forces the user online");
    noSecretsLogged(h);
  } finally {
    await h.cleanup();
  }
});

test("QR refresh replaces the link; delayed QR update after cancel is dropped and local data removed", async () => {
  const h = makeHarness();
  try {
    const id = h.store.beginLogin("biz-1", "qr");
    await h.supervisor.tick();
    await waitFor(() => h.store.logins.get(id)?.qrLink != null);
    const c = client(h, id);
    const first = h.store.logins.get(id)!.qrLink;
    c.auth("authorizationStateWaitOtherDeviceConfirmation", { link: "tg://login?token=FAKEQR_REFRESHED" });
    await waitFor(() => h.store.logins.get(id)?.qrLink === "tg://login?token=FAKEQR_REFRESHED");
    assert.notEqual(first, "tg://login?token=FAKEQR_REFRESHED");

    assert.equal(h.store.cancel(id), true);
    // TDLib emits a late refresh before the worker notices the cancel.
    c.auth("authorizationStateWaitOtherDeviceConfirmation", { link: "tg://login?token=FAKEQR_LATE" });
    await waitFor(() => h.store.rows.get(id)?.localState === "removed", 2000, "cleanup");
    assert.equal(h.store.rows.get(id)!.status, "cancelled");
    assert.ok(h.store.writes.some((w) => w.op === "login" && !w.accepted), "late QR write rejected");
    assert.ok(h.telegram.destroyed.length === 1, "unauthorized login destroyed locally, no logOut needed");
    assert.equal(existsSync(sessionDirectory(h.dataDir, id).dir), false);
    assert.equal(h.store.rows.get(id)!.dbKeyWrapped, null);
    noSecretsLogged(h);
  } finally {
    await h.cleanup();
  }
});

test("Cancel racing a completed QR scan signs the new device out instead of leaving an orphan", async () => {
  const h = makeHarness();
  try {
    const id = h.store.beginLogin("biz-1", "qr");
    await h.supervisor.tick();
    await waitFor(() => h.store.logins.get(id)?.qrLink != null);
    h.telegram.invokeHangs.add("getMe"); // hold activation until the cancel lands
    client(h, id).approveQr(OWNER);
    await waitFor(() => client(h, id).requests.some((r) => r._ === "getMe"));
    h.store.cancel(id);
    h.telegram.invokeHangs.delete("getMe");
    await waitFor(() => h.store.rows.get(id)?.localState === "removed", 3000, "cleanup after retry");
    assert.equal(h.store.rows.get(id)!.status, "cancelled");
    assert.equal(h.store.rows.get(id)!.channelActive, false);
    assert.ok(h.telegram.loggedOut.length >= 1, "authorized device was signed out");
  } finally {
    await h.cleanup();
  }
});

test("Phone + code + 2FA with sealed inputs; wrong code/password keep the step with an error code", async () => {
  const h = makeHarness();
  try {
    const id = h.store.beginLogin("biz-1", "phone");
    await h.supervisor.tick();
    await waitFor(() => h.store.rows.get(id)?.status === "waiting_phone");
    assert.ok(h.store.submitInput(id, "phone", h.sealFor(id, "phone", "+85512345678")));
    await waitFor(() => h.store.rows.get(id)?.status === "waiting_code");
    h.store.submitInput(id, "code", h.sealFor(id, "code", "00000"));
    await waitFor(() => h.store.rows.get(id)?.lastErrorCode === "PHONE_CODE_INVALID");
    assert.equal(h.store.rows.get(id)!.status, "waiting_code");
    h.store.submitInput(id, "code", h.sealFor(id, "code", "12345"));
    await waitFor(() => h.store.rows.get(id)?.status === "waiting_password");
    assert.equal(h.store.logins.get(id)!.hint, "pet name");
    h.store.submitInput(id, "password", h.sealFor(id, "password", "wrong"));
    await waitFor(() => h.store.rows.get(id)?.lastErrorCode === "PASSWORD_INVALID");
    h.store.submitInput(id, "password", h.sealFor(id, "password", "correct-horse"));
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    noSecretsLogged(h);
  } finally {
    await h.cleanup();
  }
});

test("Session isolation: input sealed for one tenant's session is rejected by another", async () => {
  const h = makeHarness();
  try {
    const a = h.store.beginLogin("biz-A", "phone");
    const b = h.store.beginLogin("biz-B", "phone", 60_000, "holder-B");
    await h.supervisor.tick();
    await waitFor(() => h.store.rows.get(a)?.status === "waiting_phone" && h.store.rows.get(b)?.status === "waiting_phone");
    h.store.submitInput(b, "phone", h.sealFor(a, "phone", "+85512345678")); // replayed blob
    await waitFor(() => h.store.rows.get(b)?.lastErrorCode === "LOGIN_INPUT_REJECTED");
    assert.ok(!client(h, b).requests.some((r) => r._ === "setAuthenticationPhoneNumber"));
    const ka = h.store.rows.get(a)!.dbKeyWrapped;
    const kb = h.store.rows.get(b)!.dbKeyWrapped;
    assert.ok(ka && kb && ka !== kb, "distinct per-session keys");
    assert.notEqual(client(h, a).options.databaseEncryptionKey, client(h, b).options.databaseEncryptionKey);
    assert.notEqual(sessionDirectory(h.dataDir, a).dir, sessionDirectory(h.dataDir, b).dir);
  } finally {
    await h.cleanup();
  }
});

test("Login expires at its deadline; unsupported auth steps fail closed", async () => {
  const h = makeHarness();
  try {
    const expiring = h.store.beginLogin("biz-1", "qr", 150);
    await h.supervisor.tick();
    await waitFor(() => h.store.rows.get(expiring)?.status === "expired", 2000, "expired");
    await waitFor(() => h.store.rows.get(expiring)?.localState === "removed");
    assert.equal(h.store.rows.get(expiring)!.lastErrorCode, "LOGIN_EXPIRED");

    const odd = h.store.beginLogin("biz-1", "qr", 60_000, "holder-2");
    await h.supervisor.tick();
    await waitFor(() => h.store.logins.get(odd)?.qrLink != null);
    client(h, odd).auth("authorizationStateWaitEmailAddress");
    await waitFor(() => h.store.rows.get(odd)?.status === "failed");
    assert.equal(h.store.rows.get(odd)!.lastErrorCode, "UNSUPPORTED_AUTH_STEP");
    await waitFor(() => h.store.rows.get(odd)?.localState === "removed");
  } finally {
    await h.cleanup();
  }
});

test("Login step timeout is reported as unknown, not as a rejection", async () => {
  const h = makeHarness();
  try {
    const id = h.store.beginLogin("biz-1", "phone");
    await h.supervisor.tick();
    await waitFor(() => h.store.rows.get(id)?.status === "waiting_phone");
    h.telegram.invokeHangs.add("setAuthenticationPhoneNumber");
    h.store.submitInput(id, "phone", h.sealFor(id, "phone", "+85512345678"));
    await waitFor(() => h.store.rows.get(id)?.lastErrorCode === "LOGIN_STEP_TIMEOUT");
    assert.equal(h.store.rows.get(id)!.status, "waiting_phone", "still open; Telegram may yet answer");
  } finally {
    await h.cleanup();
  }
});

test("Duplicate ownership: second workspace is refused and its new device is signed out", async () => {
  const h = makeHarness();
  try {
    const first = await qrLogin(h, OWNER, "biz-A");
    await waitFor(() => h.store.rows.get(first)?.status === "connected");
    const second = await qrLogin(h, OWNER, "biz-B");
    await waitFor(() => h.store.rows.get(second)?.status === "failed");
    assert.equal(h.store.rows.get(second)!.lastErrorCode, "ACCOUNT_IN_OTHER_WORKSPACE");
    await waitFor(() => h.store.rows.get(second)?.localState === "removed");
    assert.ok(h.telegram.loggedOut.includes(sessionDirectory(h.dataDir, second).database));
    assert.equal(h.store.rows.get(first)!.status, "connected", "original owner unaffected");
  } finally {
    await h.cleanup();
  }
});

test("Channel limit at activation refuses the login and signs the device out", async () => {
  const h = makeHarness();
  try {
    h.store.channelLimit.set("biz-1", 0);
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "failed");
    assert.equal(h.store.rows.get(id)!.lastErrorCode, "CHANNEL_LIMIT_REACHED");
    await waitFor(() => h.telegram.loggedOut.length === 1);
  } finally {
    await h.cleanup();
  }
});

test("Restart: graceful shutdown is clean, a new worker process reopens with the same key", async () => {
  const h = makeHarness();
  const id = await qrLogin(h);
  await waitFor(() => h.store.rows.get(id)?.status === "connected");
  const keyBefore = client(h, id).options.databaseEncryptionKey;
  const result = await h.supervisor.shutdown();
  assert.deepEqual(result, { clean: 1, unclean: 0 });
  assert.equal(h.store.rows.get(id)!.lastShutdown, "clean");
  assert.equal(h.store.rows.get(id)!.leaseOwner, null);
  assert.equal(h.store.rows.get(id)!.status, "connected", "shutdown does not disconnect the account");

  const { Supervisor } = await import("../src/supervisor.ts");
  const restarted = new Supervisor({ store: h.store, factory: h.telegram, config: h.config, log: () => undefined });
  try {
    await restarted.tick();
    await waitFor(() => client(h, id).options.databaseEncryptionKey === keyBefore && client(h, id).authState === "authorizationStateReady");
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    assert.ok(h.store.writes.some((w) => w.op === "update" && (w.patch as { status?: string })?.status === "reconnecting"), "shown as reconnecting until ready");
  } finally {
    await restarted.shutdown();
    await h.cleanup();
  }
});

test("Shutdown with a hung TDLib close is recorded as unclean, never clean", async () => {
  const h = makeHarness();
  const id = await qrLogin(h);
  await waitFor(() => h.store.rows.get(id)?.status === "connected");
  h.telegram.closeHangs = true;
  const result = await h.supervisor.shutdown();
  assert.deepEqual(result, { clean: 0, unclean: 1 });
  assert.equal(h.store.rows.get(id)!.lastShutdown, "unclean");
  await h.cleanup();
});

test("Network loss shows reconnecting after the grace period and recovers", async () => {
  const h = makeHarness();
  try {
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    client(h, id).connection("connectionStateWaitingForNetwork");
    await waitFor(() => h.store.rows.get(id)?.status === "reconnecting", 2000, "reconnecting");
    client(h, id).connection("connectionStateReady");
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
  } finally {
    await h.cleanup();
  }
});

test("Remote revocation marks the session revoked, frees the channel and removes local data", async () => {
  const h = makeHarness();
  try {
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    client(h, id).revokeRemotely();
    await waitFor(() => h.store.rows.get(id)?.status === "revoked");
    await waitFor(() => h.store.rows.get(id)?.localState === "removed");
    assert.equal(h.store.rows.get(id)!.channelActive, false);
    assert.equal(h.store.rows.get(id)!.lastErrorCode, "SESSION_REVOKED");
  } finally {
    await h.cleanup();
  }
});

test("Silent remote termination of an idle session is detected by the auth probe", async () => {
  const h = makeHarness();
  try {
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    client(h, id).revokeSilently(); // no TDLib update is emitted
    await waitFor(() => h.store.rows.get(id)?.status === "revoked", 3000, "revoked via probe");
    assert.equal(h.store.rows.get(id)!.lastErrorCode, "SESSION_REVOKED");
    assert.equal(h.store.rows.get(id)!.channelActive, false);
    await waitFor(() => h.store.rows.get(id)?.localState === "removed");
  } finally {
    await h.cleanup();
  }
});

test("Auth probe ignores network errors (no false revocation)", async () => {
  const h = makeHarness();
  try {
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    h.telegram.invokeHangs.add("getActiveSessions"); // probe times out locally
    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.equal(h.store.rows.get(id)!.status, "connected");
    assert.ok(client(h, id).requests.filter((r) => r._ === "getActiveSessions").length >= 1, "probe ran");
  } finally {
    await h.cleanup();
  }
});

test("Revoked while the worker was down is detected on restart", async () => {
  const h = makeHarness();
  const id = await qrLogin(h);
  await waitFor(() => h.store.rows.get(id)?.status === "connected");
  await h.supervisor.shutdown();
  h.telegram.authorized.clear(); // terminated from the phone while offline
  const { Supervisor } = await import("../src/supervisor.ts");
  const restarted = new Supervisor({ store: h.store, factory: h.telegram, config: h.config, log: () => undefined });
  try {
    await restarted.tick();
    await waitFor(() => h.store.rows.get(id)?.status === "revoked");
  } finally {
    await restarted.shutdown();
    await h.cleanup();
  }
});

test("Pause keeps the session on disk and frees the slot; disconnect signs out and removes it", async () => {
  const h = makeHarness();
  try {
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    h.store.requestAction(id, "pause");
    await waitFor(() => h.store.rows.get(id)?.status === "paused");
    assert.equal(h.store.rows.get(id)!.localState, "present");
    assert.ok(existsSync(sessionDirectory(h.dataDir, id).dir));
    assert.equal(h.store.rows.get(id)!.lastShutdown, "clean");
    assert.equal(h.store.commands[0].status, "done");
    assert.equal(h.telegram.loggedOut.length, 0, "pause never signs out");

    // Disconnect from paused: claimable again, signs out at Telegram.
    h.store.requestAction(id, "logout");
    await h.supervisor.tick();
    await waitFor(() => h.store.rows.get(id)?.status === "disconnected", 2000, "disconnected");
    await waitFor(() => h.store.rows.get(id)?.localState === "removed");
    assert.equal(h.telegram.loggedOut.length, 1);
    assert.equal(existsSync(sessionDirectory(h.dataDir, id).dir), false);
    assert.equal(h.store.rows.get(id)!.dbKeyWrapped, null);
  } finally {
    await h.cleanup();
  }
});

test("Unconfirmed sign-out keeps data and stays disconnect_pending (never claimed as revoked)", async () => {
  const h = makeHarness();
  try {
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    h.telegram.logoutHangs = true;
    h.store.requestAction(id, "logout");
    await waitFor(() => h.store.rows.get(id)?.lastErrorCode === "LOGOUT_UNCONFIRMED", 3000);
    assert.equal(h.store.rows.get(id)!.status, "disconnect_pending");
    assert.equal(h.store.rows.get(id)!.localState, "present");
    assert.equal(h.store.rows.get(id)!.channelActive, false, "access already disabled in TENH");
  } finally {
    await h.cleanup();
  }
});

test("Lease loss (another worker took over) stops the client and all further writes", async () => {
  const h = makeHarness();
  try {
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    h.store.stealLease(id);
    await waitFor(() => client(h, id).isClosed(), 2000, "client closed");
    const writesAfter = h.store.writes.length;
    client(h, id).connection("connectionStateWaitingForNetwork");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(h.store.writes.filter((w, i) => i >= writesAfter && w.accepted).length, 0);
    assert.equal(h.store.rows.get(id)!.leaseOwner, "worker-other");
  } finally {
    await h.cleanup();
  }
});

test("Workspace deletion (session row gone) signs the device out and wipes local data", async () => {
  const h = makeHarness();
  try {
    const id = await qrLogin(h);
    await waitFor(() => h.store.rows.get(id)?.status === "connected");
    h.store.rows.delete(id);
    await waitFor(() => h.telegram.loggedOut.length === 1, 2000, "signed out");
    await waitFor(() => !existsSync(sessionDirectory(h.dataDir, id).dir), 2000, "files removed");
  } finally {
    await h.cleanup();
  }
});

test("Supervisor respects maxSessions; sessions stay pinned to their worker", async () => {
  const h = makeHarness({ maxSessions: 1 });
  try {
    const a = h.store.beginLogin("biz-1", "qr");
    const b = h.store.beginLogin("biz-2", "qr", 60_000, "holder-2");
    await h.supervisor.tick();
    await h.supervisor.tick();
    assert.equal(h.supervisor.activeSessions, 1);
    const held = [a, b].filter((id) => h.store.rows.get(id)!.leaseOwner === "worker-A");
    assert.equal(held.length, 1);
    const other = (await import("../src/supervisor.ts")).Supervisor;
    const workerB = new other({ store: h.store, factory: h.telegram, config: { ...h.config, workerId: "worker-B" }, log: () => undefined });
    await workerB.tick();
    assert.equal(workerB.activeSessions, 1, "the unassigned session goes to worker B");
    h.store.expireLease(held[0]);
    await workerB.tick();
    assert.equal(workerB.activeSessions, 1, "worker B never takes worker A's pinned session");
    await workerB.shutdown();
  } finally {
    await h.cleanup();
  }
});

test("Database auth failures back off instead of retrying every poll", async () => {
  const h = makeHarness();
  let calls = 0;
  h.store.claimSessions = async () => {
    calls += 1;
    throw new Error("(ECIRCUITBREAKER) too many authentication failures");
  };
  try {
    for (let i = 0; i < 20; i += 1) await h.supervisor.tick();
    assert.equal(calls, 1, "one failed attempt, then a long backoff");
    assert.ok(h.logs.some((line) => line.includes("worker_database_auth_failed")));
    assert.ok(!h.logs.join("\n").includes("postgresql://"));
  } finally {
    await h.cleanup();
  }
});

test("Directory lock refuses a second live owner and recovers a stale lock", () => {
  const h = makeHarness();
  const id = "33333333-3333-4333-8333-333333333333";
  const paths = ensureSessionDirectory(h.dataDir, id);
  const release = acquireDirectoryLock(paths.lock, { workerId: "w", epoch: 1 });
  writeFileSync(paths.lock, JSON.stringify({ pid: process.ppid, workerId: "other", epoch: 2 })); // live foreign pid
  assert.throws(() => acquireDirectoryLock(paths.lock, { workerId: "w", epoch: 3 }), LockHeldError);
  writeFileSync(paths.lock, JSON.stringify({ pid: 2 ** 22 + 7, workerId: "dead", epoch: 2 })); // stale
  const again = acquireDirectoryLock(paths.lock, { workerId: "w", epoch: 4 });
  again();
  release();
  assert.throws(() => sessionDirectory(h.dataDir, "../escape"), /Invalid session id/);
  void h.cleanup();
});
