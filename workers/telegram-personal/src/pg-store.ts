import pg from "pg";
import type { LoginInputKind } from "./crypto.ts";
import type { ClaimedSession, Command, Fence, Identity, LoginPatch, SessionStatus, Store, WorkerPatch } from "./store.ts";

/**
 * Postgres implementation using the fenced tgp_* RPCs from
 * db/proposals/20261020_telegram_personal_draft.sql. Statement timeouts keep a
 * hung database from stalling lease renewal indefinitely.
 */
export class PgStore implements Store {
  private readonly pool: pg.Pool;
  private readonly connectionString: string;

  constructor(connectionString: string, poolSize = 5) {
    this.connectionString = connectionString;
    this.pool = new pg.Pool({
      connectionString,
      max: poolSize,
      statement_timeout: 10_000,
      query_timeout: 12_000,
      connectionTimeoutMillis: 10_000,
      application_name: "tenh-telegram-personal-worker",
    });
  }

  async end() {
    await this.pool.end();
  }

  private async one<T>(sql: string, params: unknown[]): Promise<T | undefined> {
    const result = await this.pool.query(sql, params);
    return result.rows[0] as T | undefined;
  }

  async claimSessions(workerId: string, ttlSeconds: number, limit: number): Promise<ClaimedSession[]> {
    const result = await this.pool.query("select * from public.tgp_claim_sessions($1, $2, $3)", [workerId, ttlSeconds, limit]);
    return result.rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      status: row.status,
      loginMethod: row.login_method,
      epoch: Number(row.lease_epoch),
      dbKeyWrapped: row.db_key_wrapped,
      localState: row.local_state,
    }));
  }

  async renewLease(f: Fence, ttlSeconds: number) {
    const row = await this.one<{ ok: boolean }>("select public.tgp_renew_lease($1,$2,$3,$4) as ok", [f.sessionId, f.workerId, f.epoch, ttlSeconds]);
    return row?.ok === true;
  }

  async releaseLease(f: Fence, shutdown: "clean" | "unclean" | null) {
    const row = await this.one<{ ok: boolean }>("select public.tgp_release_lease($1,$2,$3,$4) as ok", [f.sessionId, f.workerId, f.epoch, shutdown]);
    return row?.ok === true;
  }

  async workerUpdate(f: Fence, patch: WorkerPatch) {
    const row = await this.one<{ ok: boolean }>("select public.tgp_worker_update($1,$2,$3,$4::jsonb) as ok", [f.sessionId, f.workerId, f.epoch, JSON.stringify(patch)]);
    return row?.ok === true;
  }

  async loginUpdate(f: Fence, p: LoginPatch) {
    const row = await this.one<{ ok: boolean }>("select public.tgp_worker_login_update($1,$2,$3,$4,$5,$6,$7) as ok", [
      f.sessionId, f.workerId, f.epoch, p.status, p.qrLink ?? null, p.passwordHint ?? null, p.errorCode ?? null,
    ]);
    return row?.ok === true;
  }

  async takeLoginInput(f: Fence) {
    const row = await this.one<{ input_kind: LoginInputKind | null; input_sealed: string | null; deadline_at: Date | null }>(
      "select * from public.tgp_take_login_input($1,$2,$3)", [f.sessionId, f.workerId, f.epoch]);
    if (!row) return { input: null, deadlineAt: null };
    return {
      input: row.input_kind && row.input_sealed ? { kind: row.input_kind, sealed: row.input_sealed } : null,
      deadlineAt: row.deadline_at ? new Date(row.deadline_at) : null,
    };
  }

  async readStatus(sessionId: string) {
    const row = await this.one<{ status: SessionStatus }>("select status from public.telegram_personal_sessions where id = $1", [sessionId]);
    return row?.status ?? null;
  }

  async activate(f: Fence, identity: Identity) {
    const row = await this.one<{ result: { ok: boolean; code?: string } }>("select public.tgp_activate($1,$2,$3,$4,$5,$6,$7) as result", [
      f.sessionId, f.workerId, f.epoch, identity.telegramUserId, identity.displayName, identity.username, identity.phoneMasked,
    ]);
    return row?.result ?? { ok: false, code: "NO_RESULT" };
  }

  async claimCommands(f: Fence, limit: number): Promise<Command[]> {
    const result = await this.pool.query("select id, kind from public.tgp_claim_commands($1,$2,$3,$4)", [f.sessionId, f.workerId, f.epoch, limit]);
    return result.rows.map((row) => ({ id: row.id, kind: row.kind }));
  }

  async finishCommand(f: Fence, commandId: string, status: "done" | "failed", errorCode: string | null) {
    const row = await this.one<{ ok: boolean }>("select public.tgp_finish_command($1,$2,$3,$4,$5,$6) as ok", [commandId, f.sessionId, f.workerId, f.epoch, status, errorCode]);
    return row?.ok === true;
  }

  async listen(onWake: (sessionId: string) => void) {
    // A dedicated connection: LISTEN state does not survive pool checkouts.
    const client = new pg.Client({ connectionString: this.connectionString, application_name: "tenh-telegram-personal-listen" });
    await client.connect();
    client.on("notification", (message) => {
      if (message.channel === "telegram_personal" && message.payload) onWake(message.payload);
    });
    client.on("error", () => {
      /* Polling remains the fallback; the supervisor recreates the listener. */
    });
    await client.query("listen telegram_personal");
    return async () => {
      await client.end().catch(() => undefined);
    };
  }
}
