import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import type { KeyObject } from "node:crypto";
import { parseKek, privateKeyFromPem } from "./crypto.ts";
import { SupabaseMediaStorage, type MediaStorage } from "./media-storage.ts";

export type WorkerConfig = {
  workerId: string;
  apiId: number;
  apiHash: string;
  kek: Buffer;
  sealPrivateKey: KeyObject;
  dataDir: string;
  databaseUrl: string;
  useTestDc: boolean;
  maxSessions: number;
  leaseTtlSeconds: number;
  renewEveryMs: number;
  pollMs: number;
  closeTimeoutMs: number;
  logoutTimeoutMs: number;
  loginStepTimeoutMs: number;
  reconnectGraceMs: number;
  authProbeMs: number;
  healthPort: number | null;
  mediaStorage: MediaStorage | null;
  mediaMaxBytes: number;
};

export class ConfigError extends Error {}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new ConfigError(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

export function isWorkerEnabled(env: NodeJS.ProcessEnv) {
  return env.TELEGRAM_PERSONAL_WORKER_ENABLED === "true";
}

/** Error messages name the missing variables, never their values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const missing = ["TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_PERSONAL_KEK", "TELEGRAM_PERSONAL_DATA_DIR", "TELEGRAM_PERSONAL_DATABASE_URL"]
    .filter((name) => !env[name]);
  if (!env.TELEGRAM_PERSONAL_SEAL_PRIVATE_KEY_FILE && !env.TELEGRAM_PERSONAL_SEAL_PRIVATE_KEY) missing.push("TELEGRAM_PERSONAL_SEAL_PRIVATE_KEY_FILE");
  if (missing.length) throw new ConfigError(`Missing required worker configuration: ${missing.join(", ")}`);

  const apiId = Number(env.TELEGRAM_API_ID);
  if (!Number.isInteger(apiId) || apiId <= 0) throw new ConfigError("TELEGRAM_API_ID must be a positive integer.");
  if (!/^[0-9a-f]{32}$/i.test(env.TELEGRAM_API_HASH ?? "")) throw new ConfigError("TELEGRAM_API_HASH has an unexpected format.");

  const pem = env.TELEGRAM_PERSONAL_SEAL_PRIVATE_KEY_FILE
    ? readFileSync(env.TELEGRAM_PERSONAL_SEAL_PRIVATE_KEY_FILE, "utf8")
    : (env.TELEGRAM_PERSONAL_SEAL_PRIVATE_KEY ?? "");

  const leaseTtlSeconds = int(env, "TELEGRAM_PERSONAL_LEASE_TTL_SECONDS", 30, 15, 300);
  return {
    workerId: env.TELEGRAM_PERSONAL_WORKER_ID || hostname(),
    apiId,
    apiHash: env.TELEGRAM_API_HASH as string,
    kek: parseKek(env.TELEGRAM_PERSONAL_KEK as string),
    sealPrivateKey: privateKeyFromPem(pem),
    dataDir: env.TELEGRAM_PERSONAL_DATA_DIR as string,
    databaseUrl: env.TELEGRAM_PERSONAL_DATABASE_URL as string,
    useTestDc: env.TELEGRAM_USE_TEST_DC === "true",
    maxSessions: int(env, "TELEGRAM_PERSONAL_MAX_SESSIONS", 25, 1, 500),
    leaseTtlSeconds,
    renewEveryMs: Math.floor((leaseTtlSeconds * 1000) / 3),
    pollMs: int(env, "TELEGRAM_PERSONAL_POLL_MS", 2000, 200, 60_000),
    closeTimeoutMs: int(env, "TELEGRAM_PERSONAL_CLOSE_TIMEOUT_MS", 20_000, 1000, 120_000),
    logoutTimeoutMs: int(env, "TELEGRAM_PERSONAL_LOGOUT_TIMEOUT_MS", 30_000, 1000, 120_000),
    loginStepTimeoutMs: int(env, "TELEGRAM_PERSONAL_LOGIN_STEP_TIMEOUT_MS", 15_000, 1000, 120_000),
    reconnectGraceMs: int(env, "TELEGRAM_PERSONAL_RECONNECT_GRACE_MS", 10_000, 0, 300_000),
    authProbeMs: int(env, "TELEGRAM_PERSONAL_AUTH_PROBE_MS", 60_000, 15_000, 3_600_000),
    healthPort: env.PORT ? int(env, "PORT", 8080, 1, 65535) : null,
    // Optional: real photos, files and profile pictures. Without both, media stays a placeholder.
    mediaStorage: env.TELEGRAM_PERSONAL_STORAGE_URL && env.TELEGRAM_PERSONAL_STORAGE_KEY
      ? new SupabaseMediaStorage(env.TELEGRAM_PERSONAL_STORAGE_URL, env.TELEGRAM_PERSONAL_STORAGE_KEY)
      : null,
    mediaMaxBytes: int(env, "TELEGRAM_PERSONAL_MEDIA_MAX_MB", 20, 1, 50) * 1024 * 1024,
  };
}
