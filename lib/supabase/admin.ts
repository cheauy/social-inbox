import "server-only";

import { createClient } from "@supabase/supabase-js";
import { observedSupabaseFetch } from "@/lib/server/usage-context";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const secretKey =
  process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL.",
  );
}

if (!secretKey) {
  throw new Error(
    "Missing SUPABASE_SECRET_KEY.",
  );
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  secretKey,
  {
    global: { fetch: observedSupabaseFetch },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);
