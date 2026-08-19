const SUBSCRIPTION_ACCENT_PALETTE = [
  "#8B5CF6",
  "#3B82F6",
  "#22C55E",
  "#F97316",
  "#EC4899",
  "#14B8A6",
  "#EAB308",
  "#6366F1",
  "#06B6D4",
  "#84CC16",
] as const;

export function shortSubscriptionId(
  value: string | null | undefined,
) {
  const id = value?.trim();

  return id
    ? `#${id.slice(0, 8).toUpperCase()}`
    : "#LEGACY";
}

/*
 * Looks random to the customer but is deterministic. A subscription keeps
 * the same color across refreshes/devices without adding a database column.
 */
export function subscriptionAccentColor(
  subscriptionId: string | null | undefined,
  businessId?: string | null,
) {
  const key =
    subscriptionId?.trim() ||
    businessId?.trim() ||
    "legacy";

  let hash = 2166136261;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return SUBSCRIPTION_ACCENT_PALETTE[
    Math.abs(hash) % SUBSCRIPTION_ACCENT_PALETTE.length
  ];
}
