import "server-only";

type Credentials = { appId: string; secret: string };
export type AdvertiserGrant = { accessToken: string; advertiserIds: string[]; scopes: string[] };

async function providerPost(endpoint: "access_token" | "revoke_token", body: Record<string, unknown>, accessToken?: string) {
  const response = await fetch(`https://business-api.tiktok.com/open_api/v2.0/oauth2/${endpoint}/`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", ...(accessToken ? { "Access-Token": accessToken } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok || text.length > 1_048_576) throw new Error("Advertiser provider request failed.");
  // Native JSON source preserves TikTok's numeric scope IDs above Number.MAX_SAFE_INTEGER.
  const payload = JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      if (!context?.source || !/^\d+$/.test(context.source)) throw new Error("Unsafe provider number.");
      return context.source;
    }
    return value;
  });
  if (!payload || payload.code !== 0 || !payload.data || typeof payload.data !== "object") {
    throw new Error("Advertiser provider request failed.");
  }
  return payload.data as Record<string, unknown>;
}

export async function exchangeAdvertiserCode(credentials: Credentials, code: string): Promise<AdvertiserGrant> {
  const data = await providerPost("access_token", { app_id: credentials.appId, secret: credentials.secret,
    auth_code: code, is_long_term: true, return_advertiser_ids: true });
  if (typeof data.access_token !== "string" || !data.access_token.trim() || data.access_token.length > 8192 || /\s/.test(data.access_token)) {
    throw new Error("Invalid advertiser grant.");
  }
  // Keep the minted credential available for compensation even if provider metadata is malformed.
  const accessToken = data.access_token;
  try {
    // ponytail: at most 1,000 advertisers per grant; add provider pagination if larger grants are needed.
    if (!Array.isArray(data.advertiser_ids) || !data.advertiser_ids.length || data.advertiser_ids.length > 1000 ||
        !data.advertiser_ids.every(id => typeof id === "string" && /^\d{1,32}$/.test(id)) ||
        !Array.isArray(data.scope) || !data.scope.length || data.scope.length > 1000 || data.refresh_token !== undefined || data.expires_in !== undefined) {
      throw new Error("Invalid advertiser grant.");
    }
    const scopes = data.scope.map((scope: unknown) => {
      if ((typeof scope !== "string" && typeof scope !== "number") || !/^\d{1,32}$/.test(String(scope))) {
        throw new Error("Invalid advertiser scope.");
      }
      return String(scope);
    });
    return { accessToken, advertiserIds: [...new Set(data.advertiser_ids as string[])], scopes: [...new Set(scopes)] };
  } catch {
    // No metadata or token is exposed through the error; the route performs cleanup explicitly.
    throw new AdvertiserGrantError(accessToken);
  }
}

export class AdvertiserGrantError extends Error {
  constructor(public readonly accessToken: string) { super("Invalid advertiser grant."); }
}

export async function revokeAdvertiserGrant(credentials: Credentials, accessToken: string) {
  const data = await providerPost("revoke_token", {
    app_id: credentials.appId, secret: credentials.secret, access_token: accessToken,
  }, accessToken);
  if (data.app_id !== credentials.appId || !Array.isArray(data.advertiser_ids) ||
      !data.advertiser_ids.every(id => typeof id === "string" && /^\d{1,32}$/.test(id))) {
    throw new Error("Advertiser revocation unconfirmed.");
  }
}
