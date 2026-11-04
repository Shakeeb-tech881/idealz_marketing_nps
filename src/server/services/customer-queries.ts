import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseMobile } from "@/lib/phone";
import type { InvitationStatus, PurchaseStatus } from "@/lib/types";

export interface InteractionListRow {
  id: string;
  interaction_date: string;
  purchase_status: PurchaseStatus;
  product_category: string | null;
  product_model: string | null;
  invoice_number: string | null;
  source: string;
  customers: { id: string; full_name: string; mobile: string | null; sms_opt_out: boolean } | null;
  branches: { name: string } | null;
  employees: { full_name: string } | null;
  survey_invitations: { id: string; status: InvitationStatus; created_at: string }[];
}

export interface CustomerListParams {
  q?: string;
  branch?: string | null;
  employee?: string | null;
  status?: PurchaseStatus | null;
  survey?: "not_invited" | "invited" | "completed" | null;
  from?: string | null;
  to?: string | null;
  page: number;
  pageSize: number;
}

/** Paginated, RLS-scoped list of customer interactions (purchases / visits). */
export async function listInteractions(sb: SupabaseClient, p: CustomerListParams) {
  let customerIds: string[] | null = null;
  const q = p.q?.trim();
  if (q) {
    const mobile = normaliseMobile(q);
    let cq = sb.from("customers").select("id").limit(500);
    cq = mobile ? cq.eq("mobile", mobile) : cq.or(`full_name.ilike.%${q.replace(/[%,()]/g, "")}%,mobile.ilike.%${q.replace(/[^\d]/g, "") || "__none__"}%`);
    const { data } = await cq;
    customerIds = (data ?? []).map((d) => d.id as string);
  }

  const inviteJoin = p.survey === "invited" || p.survey === "completed" ? "survey_invitations!inner(id, status, created_at)" : "survey_invitations(id, status, created_at)";
  let query = sb
    .from("customer_interactions")
    .select(
      `id, interaction_date, purchase_status, product_category, product_model, invoice_number, source, customers(id, full_name, mobile, sms_opt_out), branches(name), employees(full_name), ${inviteJoin}`,
      { count: "exact" },
    )
    .order("interaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (q) {
    const safe = q.replace(/[%,()]/g, "");
    const ids = customerIds?.length ? customerIds.join(",") : "00000000-0000-0000-0000-000000000000";
    query = query.or(`customer_id.in.(${ids}),invoice_number.ilike.%${safe}%`);
  }
  if (p.branch) query = query.eq("branch_id", p.branch);
  if (p.employee) query = query.eq("employee_id", p.employee);
  if (p.status) query = query.eq("purchase_status", p.status);
  if (p.from) query = query.gte("interaction_date", p.from);
  if (p.to) query = query.lte("interaction_date", p.to);
  if (p.survey === "completed") query = query.eq("survey_invitations.status", "completed");
  if (p.survey === "not_invited") query = query.is("survey_invitations", null);

  const start = (p.page - 1) * p.pageSize;
  const { data, error, count } = await query.range(start, start + p.pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as unknown as InteractionListRow[], total: count ?? 0 };
}

export function latestInvitation(rows: InteractionListRow["survey_invitations"]) {
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}
