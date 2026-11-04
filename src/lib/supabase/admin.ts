import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client. BYPASSES Row Level Security.
 * Only use for: the public survey flow (token-validated), provider webhooks,
 * cron jobs, and Supabase Auth admin operations performed after an explicit
 * super-admin check. Never import from client components.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
