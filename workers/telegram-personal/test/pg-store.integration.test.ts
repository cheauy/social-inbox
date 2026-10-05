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
