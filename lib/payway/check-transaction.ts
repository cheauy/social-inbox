import "server-only";

import { createHmac } from "node:crypto";

import { getPayWayConfig } from "@/lib/payway/config";

export type PayWayCheckTransactionData = {
  payment_status_code?: number;
  total_amount?: number;
  original_amount?: number;
  refund_amount?: number;
  discount_amount?: number;
  payment_amount?: number;
  payment_currency?: string;
  apv?: string;
  payment_status?: string;
  transaction_date?: string;
};

export type PayWayCheckTransactionResponse = {
  data?: PayWayCheckTransactionData;
  status?: {
    code?: string | number;
    message?: string;
    tran_id?: string;
  };
};

function formatPayWayRequestTime() {
  /*
   * V3.8.5.15 — keep PayWay request timestamps in UTC YYYYMMDDHHmmss.
   * This matches the timestamp convention used by TENH's current PayWay
   * checkout/QR integration and avoids a +07:00 local-time skew during
   * Check Transaction verification.
   */
  const date = new Date();

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
  ].join("");
}

function createCheckTransactionHash(
  reqTime: string,
  merchantId: string,
  transactionId: string,
  apiKey: string,
) {
  /*
   * Check Transaction has three signed request values before `hash`:
   * req_time, merchant_id, tran_id. PayWay's other HMAC request signing
   * uses the documented parameter sequence, so TENH signs those values in
   * that exact request order.
   */
  return createHmac("sha512", apiKey)
    .update(`${reqTime}${merchantId}${transactionId}`, "utf8")
    .digest("base64");
}

export async function checkPayWayTransaction(transactionId: string) {
  const normalizedTransactionId = transactionId.trim();

  if (!normalizedTransactionId) {
    throw new Error("PayWay transaction ID is required.");
  }

  if (normalizedTransactionId.length > 20) {
    throw new Error("PayWay transaction ID exceeds the documented 20-character limit.");
  }

  const config = getPayWayConfig();
  const reqTime = formatPayWayRequestTime();
  const hash = createCheckTransactionHash(
    reqTime,
    config.merchantId,
    normalizedTransactionId,
    config.apiKey,
  );

  const response = await fetch(config.checkTransactionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      req_time: reqTime,
      merchant_id: config.merchantId,
      tran_id: normalizedTransactionId,
      hash,
    }),
  });

  const text = await response.text();
  let result: PayWayCheckTransactionResponse = {};

  if (text.trim()) {
    try {
      result = JSON.parse(text) as PayWayCheckTransactionResponse;
    } catch {
      throw new Error(
        `PayWay Check Transaction returned invalid JSON (HTTP ${response.status}).`,
      );
    }
  }

  if (!response.ok) {
    throw new Error(
      result.status?.message ||
        `PayWay Check Transaction failed with HTTP ${response.status}.`,
    );
  }

  return {
    reqTime,
    response: result,
  };
}
