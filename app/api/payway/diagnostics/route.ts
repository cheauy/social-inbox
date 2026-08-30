import { NextResponse } from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  getPayWayConfig,
  getPayWayReadiness,
} from "@/lib/payway/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskMerchantId(
  value: string,
) {
  if (value.length <= 4) {
    return "****";
  }

  return `${value.slice(
    0,
    4,
  )}****${value.slice(-2)}`;
}

export async function GET() {
  try {
    const authResult =
      await getCurrentMember();

    if (!authResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: authResult.error,
        },
        {
          status: authResult.status,
        },
      );
    }

    if (
      !(await memberHasPermission(
        authResult.member,
        "billing",
      "manage",
      ))
    ) {
      return permissionDenied(
        "Only the workspace owner can view PayWay diagnostics.",
      );
    }

    const config =
      getPayWayConfig();
    const readiness =
      getPayWayReadiness(config);

    return NextResponse.json(
      {
        success: true,
        environment:
          config.environment,
        liveEnabled:
          config.liveEnabled,
        readyToAcceptLivePayments:
          readiness.readyToAcceptLivePayments,
        merchantId: maskMerchantId(
          config.merchantId,
        ),
        apiKeyConfigured:
          Boolean(config.apiKey),
        purchaseUrl:
          config.purchaseUrl,
        checkTransactionUrl:
          config.checkTransactionUrl,
        appUrl: config.appUrl,
        callbackUrl:
          config.callbackUrl,
        paymentMethod:
          "ABA Pay / KHQR",
        checks: {
          ...readiness.checks,
          productionPurchaseHashGuard:
            true,
          callbackSignatureVerification:
            true,
          checkTransactionVerification:
            true,
        },
        liveBlockers:
          readiness.liveBlockers,
        sandboxLegacyPaymentGate:
          config.environment ===
          "sandbox",
        localCallbackMode:
          config.callbackUrl === null
            ? "No public callback URL; authenticated browser polling verifies payment with Check Transaction."
            : null,
        note:
          "This endpoint never returns the PayWay API key or RSA private key. readyToAcceptLivePayments validates TENH configuration and your explicit confirmations; ABA PayWay must separately approve your production merchant profile/payment method and whitelist your domain/IP.",
      },
      {
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load PayWay diagnostics.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      },
    );
  }
}
