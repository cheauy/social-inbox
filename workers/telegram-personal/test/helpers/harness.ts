import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateSealKeyPair, privateKeyFromPem, publicKeyFromRaw, randomKek, seal, sealAad, type LoginInputKind } from "./crypto-helpers.ts";
import { createLogger } from "../../src/redact.ts";
import { Supervisor, type SupervisorConfig } from "../../src/supervisor.ts";
import type { Store } from "../../src/store.ts";
import { FakeTelegram } from "./fake-telegram.ts";
import { MemoryStore } from "./memory-store.ts";

export async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 3000, label = "condition") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export function makeHarness<S extends Store = MemoryStore>(options: { store?: S; workerId?: string; maxSessions?: number; overrides?: Partial<SupervisorConfig> } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "tgp-worker-test-"));
  const pair = generateSealKeyPair();
  const sealPrivateKey = privateKeyFromPem(pair.privateKeyPem);
  const sealPublicKey = publicKeyFromRaw(pair.publicKeyBase64);
  const logs: string[] = [];
  const log = createLogger((line) => logs.push(line));
  const telegram = new FakeTelegram();
  const store = (options.store ?? new MemoryStore()) as S;
  const config: SupervisorConfig = {
    workerId: options.workerId ?? "worker-A",
    dataDir,
    kek: randomKek(),
    sealPrivateKey,
    leaseTtlSeconds: 2,
    renewEveryMs: 50,
    pollMs: 20,
    closeTimeoutMs: 300,
    logoutTimeoutMs: 300,
    loginStepTimeoutMs: 300,
    reconnectGraceMs: 60,
    authProbeMs: 80,
    maxSessions: options.maxSessions ?? 10,
    ...options.overrides,
  };
  const supervisor = new Supervisor({ store, factory: telegram, config, log });
  return {
    store,
    telegram,
    supervisor,
    config,
    logs,
    dataDir,
    sealFor(sessionId: string, kind: LoginInputKind, value: string) {
      return seal(sealPublicKey, sealAad(sessionId, kind), value);
    },
    async cleanup() {
      await supervisor.shutdown();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
