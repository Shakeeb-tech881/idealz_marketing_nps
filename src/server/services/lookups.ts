import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Branch, Employee, Profile } from "@/lib/types";

/** Branches and employees the current user may see (RLS-filtered). */
export async function getLookups(sb: SupabaseClient, opts: { includeInactive?: boolean; profile?: Profile } = {}) {
  let bq = sb.from("branches").select("id, name, code, city, address, phone, sms_sender_id, brand_name, is_active").order("name");
  let eq = sb.from("employees").select("id, branch_id, full_name, employee_code, job_title, is_active").order("full_name");
  if (!opts.includeInactive) {
    bq = bq.eq("is_active", true);
    eq = eq.eq("is_active", true);
  }
  // Branch-scoped roles only get their own branch in pickers.
  if (opts.profile && !["super_admin", "management"].includes(opts.profile.role) && opts.profile.branch_id) {
    bq = bq.eq("id", opts.profile.branch_id);
    eq = eq.eq("branch_id", opts.profile.branch_id);
  }
  const [b, e] = await Promise.all([bq, eq]);
  return { branches: (b.data ?? []) as Branch[], employees: (e.data ?? []) as Employee[] };
}
