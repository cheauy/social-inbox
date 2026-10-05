import type { Logger } from "./redact.ts";
import { SessionRunner, type RunnerConfig, type RunnerOutcome } from "./session-runner.ts";
import type { Store } from "./store.ts";
import type { TdClientFactory } from "./tdlib-port.ts";

export type SupervisorConfig = RunnerConfig & { maxSessions: number };

/**
 * Claims sessions up to maxSessions and runs one SessionRunner per claimed
 * session. Sessions stay pinned to the worker that holds their local data
 * (assigned_worker in the database).
 */
export class Supervisor {
  private readonly store: Store;
  private readonly factory: TdClientFactory;
  private readonly config: SupervisorConfig;
  private readonly log: Logger;
  private readonly runners = new Map<string, SessionRunner>();
  private readonly retryAfter = new Map<string, { at: number; attempts: number }>();
  private timer: NodeJS.Timeout | null = null;
  private unlisten: (() => Promise<void>) | null = null;
  private claiming = false;
  private draining = false;
  private claimFailures = 0;
  private claimAgain = false;
  private claimBlockedUntil = 0;

  constructor(options: { store: Store; factory: TdClientFactory; config: SupervisorConfig; log: Logger }) {
    this.store = options.store;
    this.factory = options.factory;
    this.config = options.config;
    this.log = options.log;
  }

  get activeSessions() {
    return this.runners.size;
  }

  get isDraining() {
    return this.draining;
  }

  async start() {
    try {
      this.unlisten = await this.store.listen((sessionId) => this.wake(sessionId));
    } catch (error) {
      this.log("warn", "worker_listen_unavailable", { error });
    }
    this.timer = setInterval(() => void this.tick(), this.config.pollMs);
    await this.tick();
  }

  wake(sessionId: string) {
    const runner = this.runners.get(sessionId);
    if (runner) runner.poke();
    else void this.tick();
  }

  async tick() {
    if (this.claiming) {
      // A wake-up arrived mid-claim (e.g. two sign-ins at once): claim again right after.
      this.claimAgain = true;
      return;
    }
    if (this.draining || Date.now() < this.claimBlockedUntil) return;
    const capacity = this.config.maxSessions - this.runners.size;
    if (capacity <= 0) return;
    this.claiming = true;
    try {
      const claimed = await this.store.claimSessions(this.config.workerId, this.config.leaseTtlSeconds, capacity);
      for (const session of claimed) {
        const backoff = this.retryAfter.get(session.id);
        if (this.runners.has(session.id) || (backoff && backoff.at > Date.now()) || this.draining) {
          await this.store.releaseLease({ sessionId: session.id, workerId: this.config.workerId, epoch: session.epoch }, null).catch(() => false);
          continue;
        }
        const runner = new SessionRunner({
          session,
          store: this.store,
          factory: this.factory,
          config: this.config,
          log: this.log,
          onDone: (id, outcome) => this.done(id, outcome),
        });
        this.runners.set(session.id, runner);
        runner.start().catch((error) => {
          this.log("error", "session_start_failed", { sessionId: session.id, error });
          void runner.stop().finally(() => this.done(session.id, "retry"));
        });
      }
      this.claimFailures = 0;
    } catch (error) {
      // Back off so a bad DATABASE_URL or a database outage does not hammer the
      // server (Supabase blocks clients after repeated authentication failures).
      this.claimFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      const auth = /authentication|password|ECIRCUITBREAKER|28P01|tenant or user/i.test(message);
      const delay = Math.min(auth ? 300_000 : 60_000, (auth ? 30_000 : 2_000) * 2 ** Math.min(this.claimFailures - 1, 6));
      this.claimBlockedUntil = Date.now() + delay;
      this.log(auth ? "error" : "warn", auth ? "worker_database_auth_failed" : "worker_claim_failed", {
        error,
        reason: auth ? "Check TELEGRAM_PERSONAL_DATABASE_URL (user, password, pooler host)." : "database unavailable",
        durationMs: delay,
      });
    } finally {
      this.claiming = false;
      if (this.claimAgain && !this.draining) {
        this.claimAgain = false;
        void this.tick();
      }
    }
  }

  private done(sessionId: string, outcome: RunnerOutcome) {
    this.runners.delete(sessionId);
    if (outcome === "done") {
      this.retryAfter.delete(sessionId);
      return;
    }
    const attempts = (this.retryAfter.get(sessionId)?.attempts ?? 0) + 1;
    const delay = Math.min(300_000, 2_000 * 2 ** Math.min(attempts, 8));
    this.retryAfter.set(sessionId, { at: Date.now() + delay, attempts });
  }

  /** Stops claiming, closes every client and reports how many closed cleanly. */
  async shutdown() {
    this.draining = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.unlisten?.().catch(() => undefined);
    const results = await Promise.all([...this.runners.values()].map((runner) => runner.stop()));
    const clean = results.filter((result) => result === "clean").length;
    return { clean, unclean: results.length - clean };
  }
}
