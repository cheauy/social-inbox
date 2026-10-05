import "server-only";
import { createHash } from "node:crypto";
import type { KhqrIntent } from "./contracts";
import { evaluateMockLookup, type Decision } from "./verification-policy";

export type MockKhqrTransport = (request: Readonly<{ md5: string; signal: AbortSignal }>) =>
  Promise<Readonly<{ httpStatus: number; body: unknown }>>;

/** No fetch, token, base URL, paid-at guess, bank SDK or payment request here. */
export function createMockKhqrProvider(transport: MockKhqrTransport, timeoutMs = 2000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error("Invalid mock inquiry timeout.");
  return {
    environment: "mock" as const,
    generate(intent: Omit<KhqrIntent, "payload" | "qrMd5">) {
      // Intentionally invalid EMV/KHQR so it cannot be scanned to pay.
      const payload = "TENH-NONPAYABLE-MOCK:" + JSON.stringify({
        id: intent.id, recipient: intent.recipient, currency: intent.currency,
        amountMinor: intent.amountMinor, expiresAtMs: intent.expiresAtMs,
      });
      return { payload, md5: createHash("md5").update(payload, "utf8").digest("hex") };
    },
    async verify(intent: KhqrIntent, now: () => number): Promise<Decision> {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Mock inquiry timed out.")); }, timeoutMs);
      });
      try {
        const result = await Promise.race([transport({ md5: intent.qrMd5, signal: controller.signal }), timedOut]);
        return evaluateMockLookup(intent, { environment: "mock", requestedMd5: intent.qrMd5,
          httpStatus: result.httpStatus, body: result.body }, now());
      } catch {
        return evaluateMockLookup(intent, { environment: "mock", requestedMd5: intent.qrMd5, httpStatus: 503, body: null }, now());
      } finally { if (timer !== undefined) clearTimeout(timer); }
    },
  };
}
export type MockKhqrProvider = ReturnType<typeof createMockKhqrProvider>;
