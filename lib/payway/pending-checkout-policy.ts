type SavedPendingCheckout = {
  provider_transaction_id: unknown;
  metadata?: unknown;
};

export const MAX_SUPERSEDED_PAYWAY_CHECKOUTS = 20;

/** Every unresolved attempt must keep its original provider reference. */
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

  return rows.length ? {
    code: "TENH_PAYWAY_CHECKOUT_IN_PROGRESS",
    transactionId: String(rows[0].provider_transaction_id),
  } : null;
}
