/** Decimal strings are the money boundary; never compare provider floats. */
export function decimalMinorUnits(value: unknown, currency: "USD" | "KHR"): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return null;
  const scale = currency === "USD" ? 2 : 0;
  const fraction = match[2] ?? "";
  if (/[^0]/.test(fraction.slice(scale))) return null;
  return BigInt(match[1]) * BigInt(10) ** BigInt(scale) + BigInt(fraction.slice(0, scale).padEnd(scale, "0") || "0");
}

export function centsDecimal(cents: number) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Invalid server quote.");
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
