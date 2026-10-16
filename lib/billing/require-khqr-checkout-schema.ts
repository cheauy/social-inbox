import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Called only by enabled lifecycle writers; an older/partial schema must never accept them. */
export async function requireKhqrCheckoutSchema() {
  const result = await supabaseAdmin.rpc("tenh_khqr_checkout_capabilities");
  if (result.error || result.data?.version !== 1 || result.data.accounting !== "open-checkout-reservations" ||
    result.data.originalPlanResolution !== "explicit-admin" || result.data.qrCountCap !== false) {
    throw new Error("The reviewed checkout schema is unavailable. Refresh saved status before another action.");
  }
}
