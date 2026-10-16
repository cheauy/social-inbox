import "server-only";
import { createHash } from "node:crypto";

export type BakongConfig = {
  accountType: "individual" | "merchant";
  token: string; fingerprint: string; accountId: string; merchantId: string; merchantName: string;
  merchantCity: string; acquiringBank: string; environment: "sandbox" | "production";
  baseUrl: string; checkoutRequested: boolean; dailyBudget: number;
};

export function getBakongConfig(): BakongConfig | null {
  const env = process.env;
  const environment = env.BAKONG_ENVIRONMENT;
  if (environment !== "sandbox" && environment !== "production") return null;
  const baseUrl = environment === "production" ? "https://api-bakong.nbc.gov.kh" : "https://sit-api-bakong.nbc.gov.kh";
  const accountType = env.BAKONG_ACCOUNT_TYPE;
  if (env.BAKONG_API_BASE_URL !== baseUrl || (accountType !== "merchant" && accountType !== "individual") || env.BAKONG_API_CONTRACT !== "v1-md5") return null;
  const token = env.BAKONG_API_TOKEN?.trim() ?? "";
  const accountId = env.BAKONG_ACCOUNT_ID?.trim() ?? "";
  const merchantId = env.BAKONG_MERCHANT_ID?.trim() ?? "";
  const merchantName = env.BAKONG_MERCHANT_NAME?.trim() ?? "";
  const merchantCity = env.BAKONG_MERCHANT_CITY?.trim() ?? "";
  const acquiringBank = env.BAKONG_ACQUIRING_BANK?.trim() ?? "";
  const dailyBudget = Number(env.BAKONG_DAILY_REQUEST_BUDGET ?? "90");
  const field = (s: string, max: number) => s.length > 0 && s.length <= max && /^[\x20-\x7e]+$/.test(s);
  if (!token || /\s/.test(token) || !field(accountId, 32) || !/^[^@\s]+@[^@\s]+$/.test(accountId) ||
      (accountType === "merchant" && (!field(merchantId, 32) || !field(acquiringBank, 32))) ||
      !field(merchantName, 25) || !field(merchantCity, 15) || (acquiringBank !== "" && !field(acquiringBank, 32)) ||
      !Number.isInteger(dailyBudget) || dailyBudget < 1 || dailyBudget > 10000) return null;
  // An individual account cannot reuse approval of the same token's merchant configuration.
  const fingerprint = createHash("sha256").update(accountType === "individual" ? `individual:${token}` : token).digest("hex");
  return { accountType, token, fingerprint, accountId, merchantId: accountType === "merchant" ? merchantId : "", merchantName,
    merchantCity, acquiringBank, environment, baseUrl, dailyBudget, checkoutRequested: env.BAKONG_CHECKOUT_ENABLED === "true" };
}
