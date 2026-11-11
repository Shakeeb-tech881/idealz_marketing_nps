import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeNps, npsFromTotals, pct, type NpsResult } from "@/lib/nps";
import { rpcArgs, type AnalyticsFilters } from "@/lib/analytics/filters";
import { countThemes } from "@/lib/analytics/themes";
import { scoreReps, type RepKpiTotals, type RepScore } from "@/lib/kpi";

const n = (v: unknown) => Number(v ?? 0) || 0;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, label: string): T {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return (res.data ?? ([] as unknown as T)) as T;
}

export interface Overview {
  overall: NpsResult;
  purchased: NpsResult;
  nonPurchased: NpsResult;
  invitations: number;
  dispatched: number;
  completed: number;
  delivered: number;
  failed: number;
  responseRate: number | null;
  avgStaffRating: number | null;
  comments: { total: number; promoter: number; passive: number; detractor: number };
}

export async function getOverview(sb: SupabaseClient, f: AnalyticsFilters): Promise<Overview> {
  const rows = unwrap(await sb.rpc("analytics_overview", rpcArgs(f)), "overview") as Record<string, unknown>[];
  const r = rows[0] ?? {};
  return {
    overall: computeNps({ promoters: n(r.promoters), passives: n(r.passives), detractors: n(r.detractors) }),
    purchased: npsFromTotals(n(r.purchased_total), n(r.purchased_promoters), n(r.purchased_detractors)),
    nonPurchased: npsFromTotals(n(r.non_purchased_total), n(r.non_purchased_promoters), n(r.non_purchased_detractors)),
    invitations: n(r.invitations_total),
    dispatched: n(r.invitations_dispatched),
    completed: n(r.invitations_completed),
    delivered: n(r.invitations_delivered),
    failed: n(r.invitations_failed),
    responseRate: pct(n(r.invitations_completed), n(r.invitations_dispatched)),
    avgStaffRating: num(r.avg_staff_rating),
    comments: {
      total: n(r.comments_total),
      promoter: n(r.comments_promoter),
      passive: n(r.comments_passive),
      detractor: n(r.comments_detractor),
    },
  };
}

export interface TrendPoint {
  period: string;
  overall: number | null;
  purchased: number | null;
  nonPurchased: number | null;
  responses: number;
  purchasedResponses: number;
  nonPurchasedResponses: number;
  promoters: number;
  passives: number;
  detractors: number;
}

export async function getTrend(sb: SupabaseClient, f: AnalyticsFilters, grain: "day" | "week" | "month"): Promise<TrendPoint[]> {
  const rows = unwrap(await sb.rpc("analytics_nps_trend", { ...rpcArgs(f), p_grain: grain }), "trend") as Record<string, unknown>[];
  const byPeriod = new Map<string, { p: Record<string, number>; np: Record<string, number> }>();
  const empty = () => ({ responses: 0, promoters: 0, passives: 0, detractors: 0 });
  for (const r of rows) {
    const key = String(r.period).slice(0, 10);
    const e = byPeriod.get(key) ?? { p: empty(), np: empty() };
    const target = r.survey_type === "purchased" ? e.p : e.np;
    target.responses += n(r.responses);
    target.promoters += n(r.promoters);
    target.passives += n(r.passives);
    target.detractors += n(r.detractors);
    byPeriod.set(key, e);
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { p, np }]) => {
      const all = { promoters: p.promoters + np.promoters, passives: p.passives + np.passives, detractors: p.detractors + np.detractors };
      return {
        period,
        overall: computeNps(all).nps,
        purchased: computeNps({ promoters: p.promoters, passives: p.passives, detractors: p.detractors }).nps,
        nonPurchased: computeNps({ promoters: np.promoters, passives: np.passives, detractors: np.detractors }).nps,
        responses: p.responses + np.responses,
        purchasedResponses: p.responses,
        nonPurchasedResponses: np.responses,
        ...all,
      };
    });
}

export type RatingMetric = "product_satisfaction" | "overall_experience_rating" | "staff_service_rating" | "product_pricing_satisfaction";

export async function getRatingDistribution(sb: SupabaseClient, f: AnalyticsFilters) {
  const rows = unwrap(await sb.rpc("analytics_rating_distribution", rpcArgs(f)), "ratings") as Record<string, unknown>[];
  const out: Record<RatingMetric, number[]> = {
    product_satisfaction: [0, 0, 0, 0, 0],
    overall_experience_rating: [0, 0, 0, 0, 0],
    staff_service_rating: [0, 0, 0, 0, 0],
    product_pricing_satisfaction: [0, 0, 0, 0, 0],
  };
  for (const r of rows) {
    const m = r.metric as RatingMetric;
    const rating = n(r.rating);
    if (out[m] && rating >= 1 && rating <= 5) out[m][rating - 1] = n(r.responses);
  }
  return out;
}

export async function getNpsDistribution(sb: SupabaseClient, f: AnalyticsFilters) {
  const rows = unwrap(await sb.rpc("analytics_nps_distribution", rpcArgs(f)), "nps distribution") as Record<string, unknown>[];
  const out = Array.from({ length: 11 }, (_, score) => ({ score, responses: 0 }));
  for (const r of rows) out[n(r.score)].responses = n(r.responses);
  return out;
}

export async function getNonPurchaseReasons(sb: SupabaseClient, f: AnalyticsFilters) {
  const rows = unwrap(
    await sb.rpc("analytics_non_purchase_reasons", {
      p_from: f.from, p_to: f.to, p_branch: f.branch, p_employee: f.employee, p_category: f.category,
    }),
    "reasons",
  ) as Record<string, unknown>[];
  const total = rows.reduce((s, r) => s + n(r.responses), 0);
  return rows.map((r) => ({
    reason: String(r.reason),
    responses: n(r.responses),
    detractors: n(r.detractors),
    share: pct(n(r.responses), total),
    avgStaffRating: num(r.avg_staff_rating),
  }));
}

export async function getResponseRateTrend(sb: SupabaseClient, f: AnalyticsFilters) {
  const rows = unwrap(await sb.rpc("analytics_response_rate_trend", rpcArgs(f)), "response rate") as Record<string, unknown>[];
  return rows.map((r) => ({
    period: String(r.period).slice(0, 10),
    created: n(r.created),
    dispatched: n(r.dispatched),
    completed: n(r.completed),
    rate: pct(n(r.completed), n(r.dispatched)),
  }));
}

export async function getInvitationStatus(sb: SupabaseClient, f: AnalyticsFilters) {
  const rows = unwrap(await sb.rpc("analytics_invitation_status", rpcArgs(f)), "invitation status") as Record<string, unknown>[];
  return rows.map((r) => ({ status: String(r.status), invitations: n(r.invitations) }));
}

export interface BranchPerf {
  branchId: string;
  name: string;
  code: string;
  invited: number;
  dispatched: number;
  delivered: number;
  completed: number;
  responseRate: number | null;
  nps: NpsResult;
  purchased: NpsResult;
  nonPurchased: NpsResult;
  avgStaffRating: number | null;
}

export async function getBranchPerformance(sb: SupabaseClient, f: AnalyticsFilters): Promise<BranchPerf[]> {
  const rows = unwrap(
    await sb.rpc("analytics_branch_performance", { p_from: f.from, p_to: f.to, p_survey_type: f.surveyType, p_category: f.category }),
    "branch performance",
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    branchId: String(r.branch_id),
    name: String(r.branch_name),
    code: String(r.branch_code),
    invited: n(r.invited),
    dispatched: n(r.dispatched),
    delivered: n(r.delivered),
    completed: n(r.completed),
    responseRate: pct(n(r.completed), n(r.dispatched)),
    nps: computeNps({ promoters: n(r.promoters), passives: n(r.passives), detractors: n(r.detractors) }),
    purchased: npsFromTotals(n(r.purchased_total), n(r.purchased_promoters), n(r.purchased_detractors)),
    nonPurchased: npsFromTotals(n(r.non_purchased_total), n(r.non_purchased_promoters), n(r.non_purchased_detractors)),
    avgStaffRating: num(r.avg_staff_rating),
  }));
}

export interface EmployeePerf {
  employeeId: string;
  name: string;
  branchId: string;
  branchName: string;
  isActive: boolean;
  interactions: number;
  invited: number;
  nps: NpsResult;
  avgStaffRating: number | null;
  positiveComments: number;
  negativeComments: number;
  sufficientSample: boolean;
}

export async function getEmployeePerformance(sb: SupabaseClient, f: AnalyticsFilters, minSample: number): Promise<EmployeePerf[]> {
  const rows = unwrap(
    await sb.rpc("analytics_employee_performance", { p_from: f.from, p_to: f.to, p_branch: f.branch, p_survey_type: f.surveyType, p_category: f.category }),
    "employee performance",
  ) as Record<string, unknown>[];
  return rows.map((r) => {
    const nps = computeNps({ promoters: n(r.promoters), passives: n(r.passives), detractors: n(r.detractors) });
    return {
      employeeId: String(r.employee_id),
      name: String(r.employee_name),
      branchId: String(r.branch_id),
      branchName: String(r.branch_name),
      isActive: Boolean(r.is_active),
      interactions: n(r.interactions),
      invited: n(r.invited),
      nps,
      avgStaffRating: num(r.avg_staff_rating),
      positiveComments: n(r.positive_comments),
      negativeComments: n(r.negative_comments),
      sufficientSample: nps.total >= minSample,
    };
  });
}

/** Keyword themes over the most recent comments in the filtered population. */
export async function getFeedbackThemes(sb: SupabaseClient, f: AnalyticsFilters, limit = 2000) {
  const { data, error } = await sb
    .rpc("cx_responses", rpcArgs(f))
    .select("additional_feedback, nps_category, submitted_at")
    .not("additional_feedback", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`themes: ${error.message}`);
  const rows = (data ?? []) as { additional_feedback: string | null; nps_category: string }[];
  return { analysed: rows.length, themes: countThemes(rows) };
}

export async function getRecentComments(
  sb: SupabaseClient,
  f: AnalyticsFilters,
  category: "promoter" | "detractor" | "passive" | null,
  limit = 6,
) {
  let q = sb
    .rpc("cx_responses", rpcArgs(f))
    .select("id, additional_feedback, nps_score, nps_category, survey_type, submitted_at, branch_id")
    .not("additional_feedback", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (category) q = q.eq("nps_category", category);
  const { data, error } = await q;
  if (error) throw new Error(`comments: ${error.message}`);
  return (data ?? []) as {
    id: string; additional_feedback: string; nps_score: number; nps_category: string; survey_type: string; submitted_at: string; branch_id: string;
  }[];
}

export interface DriverRow {
  category: "promoter" | "passive" | "detractor";
  responses: number;
  staff: number | null;
  product: number | null;
  overall: number | null;
  pricing: number | null;
}

export async function getDrivers(sb: SupabaseClient, f: AnalyticsFilters): Promise<DriverRow[]> {
  const rows = unwrap(await sb.rpc("analytics_drivers", rpcArgs(f)), "drivers") as Record<string, unknown>[];
  return rows.map((r) => ({
    category: r.nps_category as DriverRow["category"],
    responses: n(r.responses),
    staff: num(r.avg_staff),
    product: num(r.avg_product),
    overall: num(r.avg_overall),
    pricing: num(r.avg_pricing),
  }));
}

/** Detractor comment themes grouped by branch ("common complaints"). */
export async function getComplaintThemesByBranch(sb: SupabaseClient, f: AnalyticsFilters, limit = 3000) {
  const { data, error } = await sb
    .rpc("cx_responses", rpcArgs(f))
    .select("branch_id, additional_feedback, nps_category")
    .eq("nps_category", "detractor")
    .not("additional_feedback", "is", null)
    .limit(limit);
  if (error) throw new Error(`complaints: ${error.message}`);
  const byBranch = new Map<string, { additional_feedback: string | null; nps_category: string }[]>();
  for (const r of (data ?? []) as { branch_id: string; additional_feedback: string | null; nps_category: string }[]) {
    const list = byBranch.get(r.branch_id) ?? [];
    list.push(r);
    byBranch.set(r.branch_id, list);
  }
  return new Map([...byBranch.entries()].map(([k, rows]) => [k, { comments: rows.length, themes: countThemes(rows).slice(0, 3) }]));
}

/**
 * Sales rep scorecard: KPI totals from tracked visits plus survey feedback for
 * the same period and showroom, scored and graded by src/lib/kpi.ts.
 */
export async function getRepScorecard(sb: SupabaseClient, f: AnalyticsFilters, minFeedbackSample: number): Promise<RepScore[]> {
  const [kpiRes, feedback, leaveRes] = await Promise.all([
    sb.rpc("analytics_rep_kpis", { p_from: f.from, p_to: f.to, p_branch: f.branch }),
    getEmployeePerformance(sb, { ...f, employee: null, surveyType: null, category: null }, minFeedbackSample),
    sb.rpc("analytics_rep_leave", { p_from: f.from, p_to: f.to, p_branch: f.branch }),
  ]);
  const rows = unwrap(kpiRes, "rep kpis") as Record<string, unknown>[];
  const fb = new Map(feedback.map((e) => [e.employeeId, e]));
  const leave = new Map((unwrap(leaveRes, "rep leave") as Record<string, unknown>[]).map((l) => [String(l.employee_id), l]));
  const periodDays = Math.max(1, Math.round((Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86_400_000) + 1);
  const totals: RepKpiTotals[] = rows.map((r) => {
    const e = fb.get(String(r.employee_id));
    const l = leave.get(String(r.employee_id));
    return {
      employeeId: String(r.employee_id),
      name: String(r.employee_name),
      branchId: String(r.branch_id),
      branchName: String(r.branch_name),
      isActive: Boolean(r.is_active),
      visits: n(r.visits),
      sales: n(r.sales),
      androidPhones: n(r.android_phones),
      applePhones: n(r.apple_phones),
      otherDevices: n(r.other_devices),
      commissionAccessoriesValue: n(r.commission_accessories_value),
      nonCommissionAccessoriesValue: n(r.non_commission_accessories_value),
      timedVisits: n(r.timed_visits),
      avgVisitMinutes: num(r.avg_visit_minutes),
      measuredConversions: n(r.measured_conversions),
      avgConversionDays: num(r.avg_conversion_days),
      avgSalesSteps: num(r.avg_sales_steps),
      reviewsAsked: n(r.reviews_asked),
      reviewsConfirmed: n(r.reviews_confirmed),
      feedbackResponses: e?.nps.total ?? 0,
      avgStaffRating: e?.avgStaffRating ?? null,
      nps: e?.nps.nps ?? null,
      periodDays,
      informedLeaveDays: n(l?.informed_days),
      excusedSuddenDays: n(l?.sudden_proof_days),
      unexcusedLeaveDays: n(l?.sudden_no_proof_days),
      leaveDays: n(l?.informed_days) + n(l?.sudden_proof_days) + n(l?.sudden_no_proof_days),
    };
  });
  return scoreReps(totals, { minFeedbackSample });
}
