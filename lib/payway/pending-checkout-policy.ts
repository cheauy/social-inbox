type SavedPendingCheckout = {
  provider_transaction_id: unknown;
  metadata?: unknown;
};

export const MAX_SUPERSEDED_PAYWAY_CHECKOUTS = 20;

/** Saved checkouts created before this contract must remain available for recovery. */
export function getPendingCheckoutBlocker(rows: SavedPendingCheckout[]) {
  if (rows.length > MAX_SUPERSEDED_PAYWAY_CHECKOUTS) {
    return {
      code: "TENH_PAYWAY_PENDING_REVIEW_REQUIRED",
      transactionId: null,
    };
  }

  for (const row of rows) {
    const metadata = row.metadata && typeof row.metadata === "object" &&
      !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    const transactionId = typeof row.provider_transaction_id === "string"
      ? row.provider_transaction_id.trim()
      : "";

    if (metadata.checkout_contract_version !== 2 || !transactionId) {
      return {
        code: "TENH_PAYWAY_SAVED_CHECKOUT_PENDING",
        transactionId: transactionId || null,
      };
    }
  }

  return null;
}
