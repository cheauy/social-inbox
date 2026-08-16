import "server-only";

import {
  createHmac,
} from "node:crypto";

/*
 * PayWay Purchase signing sequence currently used by TENH.
 *
 * V3.9 DOES NOT guess a signing position for newer transport/presentation
 * parameters such as payment_gate/view_type. PayWay's current API guidance
 * says the hash must cover every parameter posted. For live production,
 * TENH therefore refuses to post a field that is not represented here.
 *
 * Sandbox keeps its existing legacy payment_gate behavior in the checkout
 * route so your current sandbox modal can continue to be tested. That legacy
 * exception is never used for production charges.
 */
export const PAYWAY_PURCHASE_HASH_ORDER = [
  "req_time",
  "merchant_id",
  "tran_id",
  "amount",
  "items",
  "shipping",
  "firstname",
  "lastname",
  "email",
  "phone",
  "type",
  "payment_option",
  "return_url",
  "cancel_url",
  "continue_success_url",
  "return_deeplink",
  "currency",
  "custom_fields",
  "return_params",
  "payout",
  "lifetime",
  "additional_params",
  "google_pay_token",
] as const;

export type PayWayPurchaseFieldName =
  | (typeof PAYWAY_PURCHASE_HASH_ORDER)[number]
  | "skip_success_page"
  | "view_type"
  | "payment_gate";

export type PayWayPurchaseFields =
  Partial<
    Record<
      PayWayPurchaseFieldName,
      string
    >
  >;

const signedFieldNames = new Set<string>(
  PAYWAY_PURCHASE_HASH_ORDER,
);

export function getUnsignedPayWayPurchaseFields(
  fields: PayWayPurchaseFields,
) {
  return Object.keys(fields).filter(
    (fieldName) =>
      fields[
        fieldName as PayWayPurchaseFieldName
      ] !== undefined &&
      !signedFieldNames.has(fieldName),
  );
}

export function assertPayWayPurchaseHashCoverage(
  fields: PayWayPurchaseFields,
) {
  const unsignedFields =
    getUnsignedPayWayPurchaseFields(
      fields,
    );

  if (unsignedFields.length > 0) {
    throw new Error(
      `Production PayWay checkout is blocked because these posted fields are not covered by TENH's Purchase hash sequence: ${unsignedFields.join(
        ", ",
      )}. Confirm the current signing sequence with ABA PayWay before enabling them in live mode.`,
    );
  }
}

export function createPayWayPurchaseHash(
  fields: PayWayPurchaseFields,
  apiKey: string,
) {
  const beforeHash =
    PAYWAY_PURCHASE_HASH_ORDER
      .map(
        (fieldName) =>
          fields[fieldName] ?? "",
      )
      .join("");

  return createHmac(
    "sha512",
    apiKey,
  )
    .update(beforeHash, "utf8")
    .digest("base64");
}
