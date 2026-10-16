import "server-only";
import { createHash } from "node:crypto";
import { BakongKHQR, IndividualInfo, MerchantInfo, khqrData } from "bakong-khqr";
import type { BakongConfig } from "./config";
import { centsDecimal, decimalMinorUnits } from "./money";

export const QR_LIFETIME_MS = 15 * 60 * 1000;
export function generateBakongQr(config: BakongConfig, id: string, cents: number, now = Date.now()) {
  const reference = `TC${id.replaceAll("-", "").slice(0, 22)}`;
  const amount = centsDecimal(cents);
  if (amount.length > 13 || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid payment reference or amount.");
  const expiresAt = now + QR_LIFETIME_MS;
  const options = { currency: khqrData.currency.usd, amount: Number(amount), billNumber: reference, expirationTimestamp: expiresAt };
  const khqr = new BakongKHQR();
  const response = config.accountType === "individual"
    ? khqr.generateIndividual(new IndividualInfo(config.accountId, config.merchantName, config.merchantCity,
        { ...options, ...(config.acquiringBank ? { acquiringBank: config.acquiringBank } : {}) }))
    : khqr.generateMerchant(new MerchantInfo(config.accountId, config.merchantName,
        config.merchantCity, config.merchantId, config.acquiringBank, options));
  if (response.status.code !== 0 || !response.data?.qr || response.data.md5 !== createHash("md5").update(response.data.qr).digest("hex")) {
    throw new Error("KHQR generation failed.");
  }
  return { qr: response.data.qr, md5: response.data.md5, reference, expiresAt: new Date(expiresAt).toISOString() };
}

export type Settlement = { md5: string; hash: string; recipient: string; amount: string; currency: "USD"; environment: "sandbox" | "production" };
export type BakongObservation = { state: "paid"; settlement: Settlement } |
  { state: "pending" | "unresolved" | "mismatch" | "credential_error"; retryAfterSeconds?: number };

export function parseBakongResponse(body: unknown, expected: { md5: string; recipient: string; amount: string; environment: BakongConfig["environment"] }): BakongObservation {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { state: "unresolved" };
  const response = body as Record<string, unknown>;
  if (response.responseCode === 1 && response.errorCode === 1 && response.data === null) return { state: "pending" };
  if (response.responseCode !== 0 || (response.errorCode !== undefined && response.errorCode !== null && response.errorCode !== 0)) return { state: "unresolved" };
  const data = response.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.hash !== "string" || !/^[a-f0-9]{64}$/i.test(data.hash)) return { state: "unresolved" };
  if (data.toAccountId !== expected.recipient || data.currency !== "USD" ||
      decimalMinorUnits(data.amount, "USD") !== decimalMinorUnits(expected.amount, "USD") ||
      decimalMinorUnits(expected.amount, "USD") === null || (data.md5 !== undefined && data.md5 !== expected.md5)) return { state: "mismatch" };
  return { state: "paid", settlement: { md5: expected.md5, hash: data.hash.toLowerCase(), recipient: expected.recipient,
    amount: expected.amount, currency: "USD", environment: expected.environment } };
}

/** One counted request, no transport retries; the shared database lease owns all scheduling. */
export async function checkBakongTransaction(config: BakongConfig, expected: Parameters<typeof parseBakongResponse>[1], fetcher = fetch): Promise<BakongObservation> {
  try {
    const response = await fetcher(`${config.baseUrl}/v1/check_transaction_by_md5`, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ md5: expected.md5 }), cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (response.status === 401 || response.status === 403) return { state: "credential_error" };
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const delay = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - Date.now()) / 1000) : 86400;
      if (Number.isFinite(delay) && delay > 2147483647) return { state: "credential_error" };
      return { state: "unresolved", retryAfterSeconds: Number.isFinite(delay) ? Math.max(300, delay) : 86400 };
    }
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 32768) return { state: "unresolved" };
    const reader = response.body?.getReader();
    if (!reader) return { state: "unresolved" };
    const decoder = new TextDecoder(); let raw = "", size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 32768) { await reader.cancel(); return { state: "unresolved" }; }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return parseBakongResponse(JSON.parse(raw), expected);
  } catch { return { state: "unresolved" }; }
}
