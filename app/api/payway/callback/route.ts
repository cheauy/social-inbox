import { NextResponse } from "next/server";

import {
  getPayWayConfig,
} from "@/lib/payway/config";
import {
  verifyAndFinalizePayWayTransaction,
} from "@/lib/payway/finalize-payment";
import {
  verifyPayWayCallbackSignature,
} from "@/lib/payway/verify-callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CALLBACK_BYTES =
  64 * 1024;

type CallbackPayload =
  Record<string, unknown>;

function cleanString(
  value: unknown,
) {
  return typeof value === "string"
    ? value.trim()
    : String(value ?? "").trim();
}

export async function POST(
  request: Request,
) {
  try {
    const config =
      getPayWayConfig();
    const rawBody =
      await request.text();

    if (
      Buffer.byteLength(
        rawBody,
        "utf8",
      ) > MAX_CALLBACK_BYTES
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "PayWay callback payload is too large.",
        },
        { status: 413 },
      );
    }

    let payload: CallbackPayload;

    try {
      payload = JSON.parse(
        rawBody,
      ) as CallbackPayload;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "PayWay callback must be valid JSON.",
        },
        { status: 400 },
      );
    }

    const receivedSignature =
      request.headers
        .get(
          "x-payway-hmac-sha512",
        )
        ?.trim() || "";

    if (
      !verifyPayWayCallbackSignature(
        payload,
        receivedSignature,
        config.apiKey,
      )
    ) {
      console.error(
        "[TENH PayWay] Rejected callback with invalid signature.",
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid PayWay callback signature.",
        },
        { status: 401 },
      );
    }

    const transactionId =
      cleanString(payload.tran_id);

    if (!transactionId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "PayWay callback is missing tran_id.",
        },
        { status: 400 },
      );
    }

    if (transactionId.length > 20) {
      return NextResponse.json(
        {
          success: false,
          error:
            "PayWay callback tran_id is invalid.",
        },
        { status: 400 },
      );
    }

    /*
     * Callback status is not trusted as the final payment result.
     * The callback signature establishes origin/integrity, then TENH calls
     * Check Transaction and requires APPROVED + matching amount before the
     * service-role activation RPC can run.
     */
    const result =
      await verifyAndFinalizePayWayTransaction(
        transactionId,
        "callback",
      );

    if (!result.found) {
      return NextResponse.json(
        {
          success: false,
          error:
            "TENH billing transaction was not found.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      transactionId,
      paymentState:
        result.paymentState,
    });
  } catch (error) {
    console.error(
      "[TENH PayWay] Callback processing failed:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to process PayWay callback.",
      },
      { status: 503 },
    );
  }
}
