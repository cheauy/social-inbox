export function isAbaPaymentLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "abamobilebank:" && url.hostname === "ababank.com" && url.searchParams.get("type") === "payway" && Boolean(url.searchParams.get("qrcode")) && !url.username && !url.password; } catch { return false; }
}
export async function requestAbaPaymentLink(checkout: { url: string; fields: Record<string, string> }) {
  const url = new URL(checkout.url);
  if (url.protocol !== "https:" || !["checkout.payway.com.kh", "checkout-sandbox.payway.com.kh"].includes(url.hostname) || url.pathname !== "/api/payment-gateway/v1/payments/purchase") throw new Error("Invalid ABA checkout address.");
  if (checkout.fields.payment_option !== "abapay_deeplink") throw new Error("The server needs the ABA app payment update. Please cancel this pending payment before trying again.");
  const form = new FormData();
  for (const [name, value] of Object.entries(checkout.fields)) form.append(name, value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url.toString(), { method: "POST", body: form, headers: { Referer: "https://app.tenhchat.com/" }, signal: controller.signal, redirect: "error" });
    const payload = await response.json();
    if (!response.ok || !["0", "00"].includes(String(payload?.status?.code)) || !isAbaPaymentLink(payload.abapay_deeplink)) throw new Error("ABA could not open this payment. Check the pending payment status before trying again.");
    return payload.abapay_deeplink as string;
  } finally { clearTimeout(timeout); }
}
