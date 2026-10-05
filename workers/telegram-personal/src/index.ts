import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { ConfigError, isWorkerEnabled, loadConfig } from "./config.ts";
import { PgStore } from "./pg-store.ts";
import { createLogger } from "./redact.ts";
import { Supervisor } from "./supervisor.ts";
import { createTdlFactory } from "./tdl-adapter.ts";

const log = createLogger();

async function main() {
  if (!isWorkerEnabled(process.env)) {
    log("info", "worker_disabled", { reason: "TELEGRAM_PERSONAL_WORKER_ENABLED is not true" });
    return 0;
  }

  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const store = new PgStore(config.databaseUrl);
  const factory = createTdlFactory({ apiId: config.apiId, apiHash: config.apiHash, useTestDc: config.useTestDc, log });
  const supervisor = new Supervisor({ store, factory, config, log });

  const health = config.healthPort
    ? createServer((request, response) => {
        const ok = request.url === "/healthz" && !supervisor.isDraining;
        response.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok, sessions: supervisor.activeSessions }));
      }).listen(config.healthPort)
    : null;

  await supervisor.start();
  log("info", "worker_started", { workerId: config.workerId, count: config.maxSessions });

  return new Promise<number>((resolve) => {
    let stopping = false;
    const shutdown = async (signal: string) => {
      if (stopping) return;
      stopping = true;
      log("info", "worker_stopping", { reason: signal });
      const result = await supervisor.shutdown();
      health?.close();
      await store.end().catch(() => undefined);
      // "clean" only counts sessions where TDLib confirmed authorizationStateClosed.
      log(result.unclean ? "warn" : "info", "worker_stopped", { count: result.clean, reason: `${result.unclean} unclean` });
      resolve(result.unclean ? 1 : 0);
    };
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
    process.once("SIGINT", () => void shutdown("SIGINT"));
  });
}

main().then(
  (code) => process.exit(code),
  (error) => {
    log("error", "worker_failed", { error: error instanceof ConfigError ? error.message : error });
    process.exit(1);
  },
);
