import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insightRpcArgs, type InsightFilters } from "@/lib/insights/filters";

export interface InsightRow {
  customerId: string;
  fullName: string;
  mobile: string | null;
  email: string | null;
  smsOptOut: boolean;
  offersOptOut: boolean;
  branches: string[];
  models: string[];
  lastModel: string | null;
  lastBranchId: string | null;
  purchases: number;
  visits: number;
  firstVisit: string | null;
  lastVisit: string | null;
  lastPurchase: string | null;
  responses: number;
  latestNps: number | null;
  latestNpsCategory: "promoter" | "passive" | "detractor" | null;
  avgStaffRating: number | null;
  latestComment: string | null;
  latestResponseAt: string | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function mapRow(r: Record<string, unknown>): InsightRow {
  return {
    customerId: String(r.customer_id),
    fullName: String(r.full_name),
    mobile: (r.mobile as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    smsOptOut: Boolean(r.sms_opt_out),
    offersOptOut: Boolean(r.offers_opt_out),
    branches: (r.branches as string[] | null) ?? [],
    models: (r.models as string[] | null) ?? [],
    lastModel: (r.last_model as string | null) ?? null,
    lastBranchId: (r.last_branch_id as string | null) ?? null,
    purchases: Number(r.purchases ?? 0),
    visits: Number(r.visits ?? 0),
    firstVisit: (r.first_visit as string | null) ?? null,
    lastVisit: (r.last_visit as string | null) ?? null,
    lastPurchase: (r.last_purchase as string | null) ?? null,
    responses: Number(r.responses ?? 0),
    latestNps: num(r.latest_nps),
    latestNpsCategory: (r.latest_nps_category as InsightRow["latestNpsCategory"]) ?? null,
    avgStaffRating: num(r.avg_staff_rating),
    latestComment: (r.latest_comment as string | null) ?? null,
    latestResponseAt: (r.latest_response_at as string | null) ?? null,
  };
}

/** One page of customers matching the filters (row-level security applies). */
export async function getCustomerInsights(sb: SupabaseClient, f: InsightFilters, page: number, pageSize = 50) {
  const { data, error } = await sb.rpc("customer_insights", insightRpcArgs(f, pageSize, (page - 1) * pageSize));
  if (error) throw new Error(`customer insights: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  return { rows: rows.map(mapRow), total: rows.length ? Number(rows[0].total_count) : 0 };
}

/** Every matching customer up to `limit` (exports, offer audiences). */
export async function getAllCustomerInsights(sb: SupabaseClient, f: InsightFilters, limit: number) {
  const { data, error } = await sb.rpc("customer_insights", insightRpcArgs(f, limit, 0));
  if (error) throw new Error(`customer insights: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  return { rows: rows.map(mapRow), total: rows.length ? Number(rows[0].total_count) : 0 };
}
