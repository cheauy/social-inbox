import "server-only";

import { createHmac } from "node:crypto";

import { getPayWayConfig } from "@/lib/payway/config";

export type PayWayCloseTransactionResponse = {
  status?: {
    code?: string | number;
    message?: string;
    tran_id?: string;
  };
};

function formatPayWayRequestTime() {
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

function createCloseTransactionHash(
  reqTime: string,
  merchantId: string,
  transactionId: string,
  apiKey: string,
) {
  return createHmac("sha512", apiKey)
    .update(`${reqTime}${merchantId}${transactionId}`, "utf8")
    .digest("base64");
}

export async function closePayWayTransaction(transactionId: string) {
  const normalizedTransactionId = transactionId.trim();
  if (!normalizedTransactionId) {
    throw new Error("PayWay transaction ID is required.");
  }
  if (normalizedTransactionId.length > 20) {
    throw new Error("PayWay transaction ID exceeds the documented 20-character limit.");
  }

  const config = getPayWayConfig();
  const reqTime = formatPayWayRequestTime();
  const hash = createCloseTransactionHash(
    reqTime,
    config.merchantId,
    normalizedTransactionId,
    config.apiKey,
  );

  const closeUrl = new URL(
    "/api/payment-gateway/v1/payments/close-transaction",
    config.checkTransactionUrl,
  ).toString();

  const response = await fetch(closeUrl, {
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
  let result: PayWayCloseTransactionResponse = {};
  if (text.trim()) {
    try {
      result = JSON.parse(text) as PayWayCloseTransactionResponse;
    } catch {
      throw new Error(
        `PayWay Close Transaction returned invalid JSON (HTTP ${response.status}).`,
      );
    }
  }

  if (!response.ok) {
    throw new Error(
      result.status?.message ||
        `PayWay Close Transaction failed with HTTP ${response.status}.`,
    );
  }

  const statusCode = String(result.status?.code ?? "");
  return {
    reqTime,
    response: result,
    closed: statusCode === "00" || statusCode === "0",
  };
}
