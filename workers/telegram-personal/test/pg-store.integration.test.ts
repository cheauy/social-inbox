import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";
import { PgStore } from "../src/pg-store.ts";
import { sessionDirectory } from "../src/local-data.ts";
import { makeHarness, waitFor } from "./helpers/harness.ts";

/*
 * Runs the real worker (fake TDLib) against the real draft SQL.
 * Requires TGP_TEST_DATABASE_URL pointing at a SCRATCH Postgres database
 * (it creates and drops a throwaway database). Never point it at TENH.
 */
const adminUrl = process.env.TGP_TEST_DATABASE_URL;
const repo = fileURLToPath(new URL("../../../", import.meta.url));

const B1 = "00000000-0000-0000-0000-0000000000b1";
const B2 = "00000000-0000-0000-0000-0000000000b2";
const U1 = "00000000-0000-0000-0000-0000000000c1";
const U2 = "00000000-0000-0000-0000-0000000000c2";
const U3 = "00000000-0000-0000-0000-0000000000c3";
const M1 = "00000000-0000-0000-0000-00000000a001";
const M2 = "00000000-0000-0000-0000-00000000a002";
const M3 = "00000000-0000-0000-0000-00000000a003";

test("PgStore + draft SQL: full lifecycle with fencing and tenant checks", { skip: !adminUrl && "TGP_TEST_DATABASE_URL not set" }, async () => {
  const dbName = `tgp_worker_it_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);
  const url = new URL(adminUrl as string);
  url.pathname = `/${dbName}`;
  const sql = new pg.Client({ connectionString: url.toString() });
  await sql.connect();
  const store = new PgStore(url.toString());
  const h = makeHarness({ store });
  try {
    await sql.query(readFileSync(`${repo}/tests/sql/telegram-personal-stub-schema.sql`, "utf8"));
    await sql.query(readFileSync(`${repo}/db/proposals/20261020_telegram_personal_draft.sql`, "utf8"));
    await sql.query(readFileSync(`${repo}/db/proposals/20261021_telegram_personal_d1.sql`, "utf8"));
    await sql.query(`insert into businesses(id) values ($1),($2)`, [B1, B2]);
    await sql.query(`insert into team_members(id,business_id,user_id,role) values ($1,$4,$5,'owner'),($2,$6,$7,'owner'),($3,$4,$8,'agent')`, [M1, M2, M3, B1, U1, B2, U2, U3]);
    await sql.query(`insert into business_subscriptions(business_id,status,channel_limit,current_period_end) values ($1,'active',2,now()+interval '30 days')`, [B1]);

    const status = async (id: string) => (await sql.query(`select status, last_error_code, local_state, last_shutdown, social_account_id from telegram_personal_sessions where id=$1`, [id])).rows[0];
    const begin = async (b: string, u: string, m: string) => (await sql.query(`select tgp_begin_login($1,$2,$3,'qr') as id`, [b, u, m])).rows[0].id as string;

    await h.supervisor.start(); // LISTEN/NOTIFY path

    // QR login -> connected (NOTIFY wakes the worker; no manual tick)
    const a = await begin(B1, U1, M1);
    await waitFor(async () => (await sql.query(`select qr_link from telegram_personal_logins where session_id=$1`, [a])).rows[0]?.qr_link != null, 3000, "qr");
    h.telegram.clientFor(sessionDirectory(h.dataDir, a).database)!.approveQr({ id: 7001, firstName: "Owner One", phone: "85511122233" });
    await waitFor(async () => (await status(a)).status === "connected", 3000, "connected");
    const account = (await status(a)).social_account_id;
    const channel = (await sql.query(`select platform, platform_account_id, is_active from social_accounts where id=$1`, [account])).rows[0];
    assert.deepEqual(channel, { platform: "telegram_personal", platform_account_id: "7001", is_active: true });

    // Same Telegram account from another workspace is refused and signed out.
    const b = await begin(B2, U2, M2);
    await waitFor(async () => (await sql.query(`select qr_link from telegram_personal_logins where session_id=$1`, [b])).rows[0]?.qr_link != null, 3000);
    h.telegram.clientFor(sessionDirectory(h.dataDir, b).database)!.approveQr({ id: 7001, firstName: "Owner One", phone: "85511122233" });
    await waitFor(async () => (await status(b)).local_state === "removed", 3000, "refused cleanup");
    assert.equal((await status(b)).last_error_code, "ACCOUNT_IN_OTHER_WORKSPACE");

    // Cancel + delayed QR refresh.
    const c = await begin(B1, U1, M1);
    await waitFor(async () => (await status(c)).status === "waiting_qr", 3000);
    assert.equal((await sql.query(`select tgp_cancel_login($1,$2,$3) as ok`, [c, B1, U1])).rows[0].ok, true);
    h.telegram.clientFor(sessionDirectory(h.dataDir, c).database)!.auth("authorizationStateWaitOtherDeviceConfirmation", { link: "tg://login?token=LATE" });
    await waitFor(async () => (await status(c)).local_state === "removed", 3000, "cancel cleanup");
    assert.equal((await status(c)).status, "cancelled");

    // An agent cannot revoke; the holder pauses; another owner cannot resume.
    const req = () => crypto.randomUUID();
    assert.equal((await sql.query(`select tgp_request_action($1,$2,$3,$4,'logout',$5) as r`, [a, B1, U3, M3, req()])).rows[0].r, "FORBIDDEN");
    assert.equal((await sql.query(`select tgp_request_action($1,$2,$3,$4,'pause',$5) as r`, [a, B1, U1, M1, req()])).rows[0].r, "OK");
    await waitFor(async () => (await status(a)).status === "paused", 3000, "paused");
    assert.equal((await status(a)).last_shutdown, "clean");
    assert.equal((await sql.query(`select is_active from social_accounts where id=$1`, [account])).rows[0].is_active, false);

    // Resume, then remote revocation.
    assert.equal((await sql.query(`select tgp_request_action($1,$2,$3,$4,'resume',$5) as r`, [a, B1, U1, M1, req()])).rows[0].r, "OK");
    await waitFor(async () => (await status(a)).status === "connected", 3000, "resumed");
    h.telegram.clientFor(sessionDirectory(h.dataDir, a).database)!.revokeRemotely();
    await waitFor(async () => (await status(a)).status === "revoked", 3000, "revoked");
    await waitFor(async () => (await status(a)).local_state === "removed", 3000);
    assert.equal((await sql.query(`select is_active from social_accounts where id=$1`, [account])).rows[0].is_active, false);

    // Reconnect the same account: the channel row (and its history) is reused.
    const d = await begin(B1, U1, M1);
    await waitFor(async () => (await status(d)).status === "waiting_qr", 3000);
    h.telegram.clientFor(sessionDirectory(h.dataDir, d).database)!.approveQr({ id: 7001, firstName: "Owner One", phone: "85511122233" });
    await waitFor(async () => (await status(d)).status === "connected", 3000);
    assert.equal((await status(d)).social_account_id, account);

    // Fencing: a stale epoch cannot write.
    const epoch = Number((await sql.query(`select lease_epoch from telegram_personal_sessions where id=$1`, [d])).rows[0].lease_epoch);
    assert.equal(await store.workerUpdate({ sessionId: d, workerId: "worker-A", epoch: epoch - 1 }, { status: "revoked" }), false);

    // D1: list chats, share one, receive messages through the real SQL.
    const listCmd = (await sql.query(`select tgp_request_chat_list($1,$2,$3,$4) as id`, [d, B1, U1, M1])).rows[0].id as string;
    await waitFor(async () => (await sql.query(`select tgp_read_chat_list($1,$2,$3,$4)->>'state' as s`, [listCmd, d, B1, U1])).rows[0].s === "ready", 3000, "chat list");
    const shared = (await sql.query(`select tgp_share_chat($1,$2,$3,$4,'5001','none') as r`, [d, B1, U1, M1])).rows[0].r;
    assert.equal(shared.ok, true, JSON.stringify(shared));
    const dClient = h.telegram.clientFor(sessionDirectory(h.dataDir, d).database)!;
    await waitFor(async () => dClient.requests.some((r) => r._ === "getChatHistory"), 3000, "share picked up via NOTIFY or poll");
    const { FakeTelegram } = await import("./helpers/fake-telegram.ts");
    const later = Math.floor(Date.now() / 1000) + 5;
    const msg = FakeTelegram.textMessage(5001, 4242, "hello from Telegram", { date: later });
    dClient.receive(msg);
    dClient.emit({ _: "updateNewMessage", message: msg }); // duplicate update
    dClient.receive(FakeTelegram.textMessage(5002, 1, "unshared", { date: later }));
    await waitFor(async () => Number((await sql.query(`select count(*) from telegram_personal_messages`)).rows[0].count) === 1, 3000, "ingested");
    const chat = (await sql.query(`select unread_count, last_message_preview from telegram_personal_chats where chat_id='5001'`)).rows[0];
    assert.deepEqual(chat, { unread_count: 1, last_message_preview: "hello from Telegram" });
    await waitFor(async () => Number((await sql.query(`select count(*) from telegram_personal_unshared_activity`)).rows[0].count) === 1, 3000, "waiting count");
    assert.equal((await sql.query(`select count(*)::int as n from telegram_personal_messages where body = 'unshared'`)).rows[0].n, 0);

    // Disconnect by another owner of the same workspace is allowed (revocation).
    await sql.query(`insert into team_members(business_id,user_id,role) values ($1,'00000000-0000-0000-0000-0000000000c9','owner')`, [B1]);
    assert.equal((await sql.query(`select tgp_request_action($1,$2,'00000000-0000-0000-0000-0000000000c9',$3,'logout',$4) as r`, [d, B1, M1, req()])).rows[0].r, "OK");
    await waitFor(async () => (await status(d)).status === "disconnected", 3000, "disconnected");
    await waitFor(async () => (await status(d)).local_state === "removed", 3000);
    assert.equal((await sql.query(`select count(*)::int as n from telegram_personal_commands where status <> 'done'`)).rows[0].n, 0);
  } finally {
    await h.cleanup();
    await store.end();
    await sql.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  }
});

test("PgStore without the D1 SQL degrades gracefully (worker updated before the database)", { skip: !adminUrl && "TGP_TEST_DATABASE_URL not set" }, async () => {
  const dbName = `tgp_worker_nod1_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);
  const url = new URL(adminUrl as string);
  url.pathname = `/${dbName}`;
  const sql = new pg.Client({ connectionString: url.toString() });
  await sql.connect();
  const store = new PgStore(url.toString());
  try {
    await sql.query(readFileSync(`${repo}/tests/sql/telegram-personal-stub-schema.sql`, "utf8"));
    await sql.query(readFileSync(`${repo}/db/proposals/20261020_telegram_personal_draft.sql`, "utf8"));
    await sql.query(`insert into businesses(id) values ($1)`, [B1]);
    await sql.query(`insert into team_members(id,business_id,user_id,role) values ($1,$2,$3,'owner')`, [M1, B1, U1]);
    const id = (await sql.query(`select tgp_begin_login($1,$2,$3,'qr') as id`, [B1, U1, M1])).rows[0].id as string;
    const [claimed] = await store.claimSessions("w", 30, 5);
    const fence = { sessionId: id, workerId: "w", epoch: claimed.epoch };
    assert.deepEqual(await store.claimCommands(fence, 5), [], "falls back to the original claim function");
    assert.deepEqual(await store.sharedChats(fence), []);
    assert.equal((await store.ingestMessage(fence, { chatId: "1", messageId: 1, direction: "incoming", type: "text", body: "x", placeholder: null, sentAt: new Date().toISOString() })).result, "UNAVAILABLE");
  } finally {
    await store.end();
    await sql.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  }
});

test("PgStore + unified inbox SQL: receive into the inbox, holder-only send, at most once", { skip: !adminUrl && "TGP_TEST_DATABASE_URL not set" }, async () => {
  const dbName = `tgp_worker_unified_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);
  const url = new URL(adminUrl as string);
  url.pathname = `/${dbName}`;
  const sql = new pg.Client({ connectionString: url.toString() });
  await sql.connect();
  const store = new PgStore(url.toString());
  const h = makeHarness({ store });
  try {
    for (const file of [
      "tests/sql/telegram-personal-stub-schema.sql",
      "db/proposals/20261020_telegram_personal_draft.sql",
      "db/proposals/20261021_telegram_personal_d1.sql",
      "tests/sql/live-inbox-functions-20261005.sql",
      "db/proposals/20261022_telegram_personal_unified_inbox.sql",
      "db/proposals/20261023_telegram_personal_auto_share.sql",
    ]) await sql.query(readFileSync(`${repo}/${file}`, "utf8"));
    await sql.query(`insert into businesses(id) values ($1)`, [B1]);
    await sql.query(`insert into team_members(id,business_id,user_id,role) values ($1,$2,$3,'owner'),($4,$2,$5,'agent')`, [M1, B1, U1, M3, U3]);
    await sql.query(`insert into business_subscriptions(business_id,status,channel_limit,current_period_end) values ($1,'active',2,now()+interval '30 days')`, [B1]);

    await h.supervisor.start();
    const a = (await sql.query(`select tgp_begin_login($1,$2,$3,'qr') as id`, [B1, U1, M1])).rows[0].id as string;
    await waitFor(async () => (await sql.query(`select qr_link from telegram_personal_logins where session_id=$1`, [a])).rows[0]?.qr_link != null, 3000, "qr");
    const tg = h.telegram.clientFor(sessionDirectory(h.dataDir, a).database)!;
    tg.approveQr({ id: 7001, firstName: "Owner One", phone: "85511122233" });
    await waitFor(async () => (await sql.query(`select status from telegram_personal_sessions where id=$1`, [a])).rows[0].status === "connected", 3000, "connected");

    // History "none": an older message must not be imported when sharing.
    const { FakeTelegram } = await import("./helpers/fake-telegram.ts");
    h.telegram.history.set(5001, [FakeTelegram.textMessage(5001, 100, "before sharing", { date: Math.floor(Date.now() / 1000) - 3600 })]);
    const listCmd = (await sql.query(`select tgp_request_chat_list($1,$2,$3,$4) as id`, [a, B1, U1, M1])).rows[0].id as string;
    await waitFor(async () => (await sql.query(`select tgp_read_chat_list($1,$2,$3,$4)->>'state' as s`, [listCmd, a, B1, U1])).rows[0].s === "ready", 3000, "chat list");
    assert.equal((await sql.query(`select tgp_share_chat($1,$2,$3,$4,'5001','none') as r`, [a, B1, U1, M1])).rows[0].r.ok, true);
    await waitFor(async () => tg.requests.some((r) => r._ === "getChatHistory"), 3000, "share picked up");

    const later = Math.floor(Date.now() / 1000) + 5;
    tg.receive(FakeTelegram.textMessage(5001, 4242, "hello from Telegram", { date: later }));
    await waitFor(async () => Number((await sql.query(`select count(*) from messages where platform_message_id like 'tgp:%'`)).rows[0].count) === 1, 3000, "ingested into inbox");
    const conv = (await sql.query(`select id, unread_count, platform from conversations where platform = 'telegram_personal'`)).rows[0];
    assert.equal(conv.unread_count, 1);
    assert.equal((await sql.query(`select count(*)::int as n from messages where message_text = 'before sharing'`)).rows[0].n, 0, "history none imports nothing older");

    // Teammate: refused. Holder: sent once, recorded with the request id.
    const reqId = crypto.randomUUID();
    const enqueue = (user: string, member: string, id: string, text: string) =>
      sql.query(`select tgp_enqueue_send($1,$2,$3,$4,$5,$6) as r`, [conv.id, B1, user, member, id, text]).then((r) => r.rows[0].r);
    assert.equal((await enqueue(U3, M3, crypto.randomUUID(), "agent")).code, "HOLDER_ONLY");
    assert.equal((await enqueue(U1, M1, reqId, "reply from TENH")).ok, true);
    const state = async () => (await sql.query(`select tgp_send_state($1,$2,$3,$4) as s`, [conv.id, B1, U1, reqId])).rows[0].s;
    await waitFor(async () => (await state()).state === "done", 3000, "send done");
    const sent = (await sql.query(`select direction, message_text, sent_by_member_id, raw_payload->>'tenh_client_request_id' as req, delivery_status from messages where id = $1`, [(await state()).message_id])).rows[0];
    assert.deepEqual(sent, { direction: "outgoing", message_text: "reply from TENH", sent_by_member_id: M1, req: reqId, delivery_status: "sent" });
    assert.equal((await enqueue(U1, M1, reqId, "reply from TENH")).duplicate, true, "same request id is not queued again");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(h.telegram.delivered.length, 1, "delivered exactly once");

    // No outcome from Telegram: stays in flight, then the sweep marks it uncertain; never resent.
    h.telegram.sendOutcome = "silent";
    await new Promise((resolve) => setTimeout(resolve, 1100)); // 1 per second limit
    const silentId = crypto.randomUUID();
    assert.equal((await enqueue(U1, M1, silentId, "no answer")).ok, true);
    const silentState = async () => (await sql.query(`select tgp_send_state($1,$2,$3,$4) as s`, [conv.id, B1, U1, silentId])).rows[0].s.state;
    await waitFor(async () => (await silentState()) === "sending", 3000, "in flight");
    const epoch = Number((await sql.query(`select lease_epoch from telegram_personal_sessions where id=$1`, [a])).rows[0].lease_epoch);
    assert.equal(await store.sendMarkStale({ sessionId: a, workerId: h.config.workerId, epoch }, 0), 1);
    assert.equal(await silentState(), "uncertain");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(tg.requests.filter((r) => r._ === "sendMessage").length, 2, "the uncertain send is never retried");

    // Automatic sharing: a message from a new person brings the chat in; a bot does not.
    assert.equal((await sql.query(`select tgp_set_auto_share($1,$2,$3,true) as r`, [a, B1, U1])).rows[0].r, "OK");
    tg.receive(FakeTelegram.textMessage(6001, 1, "bot says", { date: later }));
    tg.receive(FakeTelegram.textMessage(5002, 77, "new person", { date: later }));
    await waitFor(async () => Number((await sql.query(`select count(*) from conversations where platform = 'telegram_personal'`)).rows[0].count) === 2, 3000, "auto-shared");
    assert.equal((await sql.query(`select count(*)::int as n from messages where message_text = 'bot says'`)).rows[0].n, 0);
    assert.equal((await sql.query(`select title from telegram_personal_chats where chat_id = '5002'`)).rows[0].title, "Customer B");
  } finally {
    await h.cleanup();
    await store.end();
    await sql.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  }
});
