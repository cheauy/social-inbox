import "server-only";

export type KhqrReadiness = Readonly<{
  provider: "khqr";
  enabled: false;
  liveEnabled: false;
  requestedEnvironment: "unconfirmed" | "mock" | "sit" | "production";
  blockers: readonly string[];
}>;

/** Reads no credential or endpoint. An environment selection cannot enable live
 * transport or financial writes; their current contracts are not approved.
 */
export function getKhqrReadiness(environment: string | undefined = process.env.TENH_KHQR_ENVIRONMENT): KhqrReadiness {
  const requestedEnvironment = environment === "mock" || environment === "sit" || environment === "production"
    ? environment : "unconfirmed";
  return {
    provider: "khqr", enabled: false, liveEnabled: false, requestedEnvironment,
    blockers: [
      ...(requestedEnvironment === "unconfirmed" ? ["ENVIRONMENT_UNCONFIRMED"] : []),
      "CURRENT_NBC_CONTRACT_UNAPPROVED", "MERCHANT_BINDING_UNCONFIRMED", "BILLING_FACADE_UNAVAILABLE",
    ],
  };
}
