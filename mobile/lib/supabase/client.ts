import "react-native-url-polyfill/auto";
import { createClient, processLock } from "@supabase/supabase-js";
import { sessionStorage } from "../auth/secure-storage";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
export const configured = Boolean(url && key && process.env.EXPO_PUBLIC_TENH_API_URL);
export const supabase = createClient(url || "https://unconfigured.supabase.co", key || "unconfigured", {
  auth: { storage: sessionStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, lock: processLock },
});
export const authCookieName = `sb-${new URL(url || "https://unconfigured.supabase.co").hostname.split(".")[0]}-auth-token`;
