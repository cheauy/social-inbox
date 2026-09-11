import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { usageContext, type RequestUsage } from "@/lib/server/usage-context";

export async function recordRequestUsage(usage: RequestUsage) {
  const snapshot = { ...usage };
  console.info(JSON.stringify({ event: "tenh.request_usage", at: new Date().toISOString(), ...snapshot }));
  if (process.env.TENH_USAGE_MODE !== "database") return;
  // Do not meter the metering RPC itself. It returns no customer data.
  await usageContext.exit(async () => {
    try {
      const { error } = await supabaseAdmin.rpc("tenh_record_request_usage", {
        p_business_id: snapshot.businessId,
        p_route: snapshot.route,
        p_database_requests: snapshot.databaseRequests,
        p_database_bytes: snapshot.databaseResponseBytes,
        p_storage_bytes: snapshot.storageResponseBytes,
        p_upload_bytes: snapshot.uploadBytes,
      });
      if (error) console.warn("TENH usage persistence unavailable; usage remains in server logs.");
    } catch { console.warn("TENH usage persistence unavailable; usage remains in server logs."); }
  });
}
