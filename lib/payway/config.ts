import "server-only";

const DEFAULT_SANDBOX_PURCHASE_URL =
  "https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase";

const DEFAULT_SANDBOX_CHECK_URL =
  "https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/check-transaction-2";

export type PayWayEnvironment =
  | "sandbox"
  | "production";

export type PayWayConfig = {
  environment: PayWayEnvironment;
  liveEnabled: boolean;
  merchantId: string;
  apiKey: string;
  purchaseUrl: string;
  checkTransactionUrl: string;
  appUrl: string;
  callbackUrl: string | null;
  productionCredentialsConfirmed: boolean;
  abaKhqrEnabledConfirmed: boolean;
  whitelistConfirmed: boolean;
};

export type PayWayReadinessChecks = {
  merchantIdConfigured: boolean;
  apiKeyConfigured: boolean;
  purchaseEnvironmentMatches: boolean;
  checkTransactionEnvironmentMatches: boolean;
  productionAppUrlReady: boolean;
  callbackReady: boolean;
  productionCredentialsConfirmed: boolean;
  abaKhqrEnabledConfirmed: boolean;
  whitelistConfirmed: boolean;
  liveSwitchEnabled: boolean;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is missing.`);
  }

  return value;
}

function readBoolean(name: string) {
  return (
    process.env[name]?.trim().toLowerCase() ===
    "true"
  );
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackOrPrivateHostname(
  hostname: string,
) {
  const host = hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1"
  ) {
    return true;
  }

  const ipv4 = host.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );

  if (!ipv4) {
    return false;
  }

  const octets = ipv4
    .slice(1)
    .map((value) => Number(value));

  if (
    octets.some(
      (value) =>
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255,
    )
  ) {
    return true;
  }

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 &&
      octets[1] >= 16 &&
      octets[1] <= 31) ||
    (octets[0] === 192 &&
      octets[1] === 168)
  );
}

function isPublicHttpsUrl(value: string) {
  const url = parseUrl(value);

  return Boolean(
    url &&
      url.protocol === "https:" &&
      !isLoopbackOrPrivateHostname(
        url.hostname,
      ),
  );
}

function isPayWayHostname(hostname: string) {
  const host = hostname.toLowerCase();

  return (
    host === "payway.com.kh" ||
    host.endsWith(".payway.com.kh")
  );
}

function endpointMatchesEnvironment(
  value: string,
  environment: PayWayEnvironment,
  expectedPathSuffix: string,
) {
  const url = parseUrl(value);

  if (
    !url ||
    url.protocol !== "https:" ||
    !isPayWayHostname(url.hostname) ||
    !url.pathname.endsWith(
      expectedPathSuffix,
    )
  ) {
    return false;
  }

  const looksSandbox =
    url.hostname
      .toLowerCase()
      .includes("sandbox");

  return environment === "sandbox"
    ? looksSandbox
    : !looksSandbox;
}

function deriveCallbackUrl(
  appUrl: string,
  explicitCallbackUrl: string,
) {
  if (explicitCallbackUrl) {
    return normalizeUrl(
      explicitCallbackUrl,
    );
  }

  if (!isPublicHttpsUrl(appUrl)) {
    return null;
  }

  return `${normalizeUrl(
    appUrl,
  )}/api/payway/callback`;
}

export function getPayWayConfig(): PayWayConfig {
  const requestedEnvironment =
    process.env.PAYWAY_ENV
      ?.trim()
      .toLowerCase() || "sandbox";

  if (
    requestedEnvironment !== "sandbox" &&
    requestedEnvironment !== "production"
  ) {
    throw new Error(
      "PAYWAY_ENV must be sandbox or production.",
    );
  }

  const environment =
    requestedEnvironment as PayWayEnvironment;
  const liveEnabled = readBoolean(
    "PAYWAY_LIVE_ENABLED",
  );

  if (
    environment === "sandbox" &&
    liveEnabled
  ) {
    throw new Error(
      "PAYWAY_LIVE_ENABLED cannot be true while PAYWAY_ENV=sandbox.",
    );
  }

  const merchantId = requiredEnv(
    "PAYWAY_MERCHANT_ID",
  );
  const apiKey = requiredEnv(
    "PAYWAY_API_KEY",
  );
  const appUrl = normalizeUrl(
    requiredEnv("TENH_APP_URL"),
  );

  const purchaseUrl = normalizeUrl(
    environment === "sandbox"
      ? process.env.PAYWAY_PURCHASE_URL?.trim() ||
          DEFAULT_SANDBOX_PURCHASE_URL
      : requiredEnv(
          "PAYWAY_PURCHASE_URL",
        ),
  );

  const checkTransactionUrl = normalizeUrl(
    environment === "sandbox"
      ? process.env.PAYWAY_CHECK_TRANSACTION_URL?.trim() ||
          DEFAULT_SANDBOX_CHECK_URL
      : requiredEnv(
          "PAYWAY_CHECK_TRANSACTION_URL",
        ),
  );

  const callbackUrl = deriveCallbackUrl(
    appUrl,
    process.env.PAYWAY_CALLBACK_URL?.trim() ||
      "",
  );

  return {
    environment,
    liveEnabled,
    merchantId,
    apiKey,
    purchaseUrl,
    checkTransactionUrl,
    appUrl,
    callbackUrl,
    productionCredentialsConfirmed:
      readBoolean(
        "PAYWAY_PRODUCTION_CREDENTIALS_CONFIRMED",
      ),
    abaKhqrEnabledConfirmed:
      readBoolean(
        "PAYWAY_ABA_KHQR_ENABLED_CONFIRMED",
      ),
    whitelistConfirmed:
      readBoolean(
        "PAYWAY_WHITELIST_CONFIRMED",
      ),
  };
}

export function getPayWayReadiness(
  config: PayWayConfig,
) {
  const production =
    config.environment === "production";

  const callbackUrl =
    config.callbackUrl ?? "";
  const callbackParsed =
    parseUrl(callbackUrl);

  const checks: PayWayReadinessChecks = {
    merchantIdConfigured:
      Boolean(config.merchantId),
    apiKeyConfigured:
      Boolean(config.apiKey),
    purchaseEnvironmentMatches:
      endpointMatchesEnvironment(
        config.purchaseUrl,
        config.environment,
        "/api/payment-gateway/v1/payments/purchase",
      ),
    checkTransactionEnvironmentMatches:
      endpointMatchesEnvironment(
        config.checkTransactionUrl,
        config.environment,
        "/api/payment-gateway/v1/payments/check-transaction-2",
      ),
    productionAppUrlReady:
      !production ||
      isPublicHttpsUrl(config.appUrl),
    callbackReady:
      !production ||
      Boolean(
        callbackParsed &&
          isPublicHttpsUrl(
            callbackUrl,
          ) &&
          callbackParsed.pathname.endsWith(
            "/api/payway/callback",
          ),
      ),
    productionCredentialsConfirmed:
      !production ||
      config.productionCredentialsConfirmed,
    abaKhqrEnabledConfirmed:
      !production ||
      config.abaKhqrEnabledConfirmed,
    whitelistConfirmed:
      !production ||
      config.whitelistConfirmed,
    liveSwitchEnabled:
      !production || config.liveEnabled,
  };

  const liveBlockers = Object.entries(
    checks,
  )
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    checks,
    liveBlockers,
    readyToAcceptLivePayments:
      production &&
      config.liveEnabled &&
      liveBlockers.length === 0,
  };
}
