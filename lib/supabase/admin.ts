import { createClient } from "@supabase/supabase-js";
import { fetchSupabase } from "@/lib/supabase/fetch";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error("Supabase server environment variables are not configured.");
  }

  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchSupabase },
  });
}
