import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

type CallbackPayload =
  Record<string, unknown>;

function callbackValueToString(
  value: unknown,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (
    Array.isArray(value) ||
    typeof value === "object"
  ) {
    return JSON.stringify(value);
  }

  /*
   * Mirrors PHP string concatenation in PayWay's callback example:
   * true -> "1", false -> "".
   */
  if (typeof value === "boolean") {
    return value ? "1" : "";
  }

  return String(value);
}

function createSignatureDigest(
  payload: CallbackPayload,
  apiKey: string,
) {
  const beforeHash = Object.keys(payload)
    .sort()
    .map((key) =>
      callbackValueToString(
        payload[key],
      ),
    )
    .join("");

  return createHmac(
    "sha512",
    apiKey,
  )
    .update(beforeHash, "utf8")
    .digest();
}

export function createPayWayCallbackSignature(
  payload: CallbackPayload,
  apiKey: string,
) {
  return createSignatureDigest(
    payload,
    apiKey,
  ).toString("base64");
}

export function verifyPayWayCallbackSignature(
  payload: CallbackPayload,
  receivedSignature: string,
  apiKey: string,
) {
  const normalizedSignature =
    receivedSignature.trim();

  if (!normalizedSignature) {
    return false;
  }

  const expectedDigest =
    createSignatureDigest(
      payload,
      apiKey,
    );

  let receivedDigest: Buffer;

  try {
    receivedDigest = Buffer.from(
      normalizedSignature,
      "base64",
    );
  } catch {
    return false;
  }

  if (
    receivedDigest.length !==
    expectedDigest.length
  ) {
    return false;
  }

  return timingSafeEqual(
    expectedDigest,
    receivedDigest,
  );
}
