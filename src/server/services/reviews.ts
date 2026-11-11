import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { MANAGERS } from "@/lib/auth";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import type { Profile } from "@/lib/types";
import { friendlyDbError } from "./customers";

export type ReviewCheckStatus = "asked" | "confirmed" | "not_found";

export interface ReviewCheckRow {
  id: string;
  interaction_date: string;
  google_review: ReviewCheckStatus;
  review_checked_at: string | null;
  product_model: string | null;
  customers: { full_name: string; mobile: string | null } | null;
  employees: { full_name: string } | null;
  branches: { name: string } | null;
  checker: { full_name: string } | null;
}

/** Visits where the rep asked for a Google review, with the manager's check (row-level security applies). */
export async function listReviewChecks(sb: SupabaseClient, f: AnalyticsFilters, show: "to_check" | "checked" | "all") {
  let q = sb
    .from("customer_interactions")
    .select("id, interaction_date, google_review, review_checked_at, product_model, customers(full_name, mobile), employees(full_name), branches(name), checker:review_checked_by(full_name)")
    .gte("interaction_date", f.from)
    .lte("interaction_date", f.to)
    .order("interaction_date", { ascending: false })
    .limit(500);
  q = show === "to_check" ? q.eq("google_review", "asked") : show === "checked" ? q.in("google_review", ["confirmed", "not_found"]) : q.in("google_review", ["asked", "confirmed", "not_found"]);
  if (f.branch) q = q.eq("branch_id", f.branch);
  if (f.employee) q = q.eq("employee_id", f.employee);
  const { data, error } = await q;
  if (error) throw new Error(`reviews: ${error.message}`);
  return (data ?? []) as unknown as ReviewCheckRow[];
}

/** Manager marks whether the review was found on Google (or undoes the check). */
export async function setReviewStatus(actor: Profile, interactionId: string, status: ReviewCheckStatus) {
  if (!MANAGERS.includes(actor.role)) return { ok: false as const, error: "Only managers can confirm Google reviews." };
  if (!["asked", "confirmed", "not_found"].includes(status)) return { ok: false as const, error: "Unknown status." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_interactions")
    .update({ google_review: status })
    .eq("id", interactionId)
    .in("google_review", ["asked", "confirmed", "not_found"])
    .select("id");
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  if (!data?.length) return { ok: false as const, error: "Visit not found, or you cannot edit visits of this showroom." };
  await supabase.rpc("log_audit", { p_action: `google_review.${status}`, p_entity_type: "customer_interactions", p_entity_id: interactionId, p_details: {} });
  return { ok: true as const };
}
