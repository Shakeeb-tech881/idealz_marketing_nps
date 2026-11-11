import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsFilters } from "@/lib/analytics/filters";
import { formatNps, pct } from "@/lib/nps";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMobile, maskMobile } from "@/lib/phone";
import { NON_PURCHASE_REASON_LABELS, SURVEY_TYPE_LABELS, type NonPurchaseReason, type SurveyType } from "@/lib/survey/definitions";
import { INVITATION_STATUS_LABELS, RESOLUTION_LABELS, type InvitationStatus, type Profile, type ResolutionStatus } from "@/lib/types";
import { canSeeContactDetails } from "@/lib/auth";
import { getBranchPerformance, getEmployeePerformance, getNonPurchaseReasons, getOverview, getRepScorecard, getResponseRateTrend, getTrend } from "@/server/services/analytics";
import { AVERAGE_SCORE, COMMISSION_ACCESSORY_WEIGHT, GRADE_BANDS, KPI_WEIGHTS, LEAVE_PENALTY_PER_DAY, MAX_LEAVE_PENALTY, MIN_GRADED_VISITS, repStatusText, type KpiKey } from "@/lib/kpi";
import { SALES_STEPS } from "@/lib/types";
import { REPORT_TYPES, type ReportData, type ReportType } from "./definitions";
import { describeInsightFilters, parseInsightFilters } from "@/lib/insights/filters";
import { getAllCustomerInsights } from "@/server/services/insights";

const MAX_ROWS = 20000;
const PAGE = 1000;

/** PostgREST caps responses (default 1000 rows) — page through results. */
async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

interface ResponseRow {
  submitted_at: string;
  survey_type: SurveyType;
  nps_score: number;
  nps_category: string;
  product_satisfaction: number | null;
  staff_service_rating: number;
  overall_experience_rating: number | null;
  product_pricing_satisfaction: number | null;
  non_purchase_reason: NonPurchaseReason | null;
  other_reason_description: string | null;
  additional_feedback: string | null;
  resolution_status: ResolutionStatus;
  customers: { full_name: string; mobile: string | null } | null;
  branches: { name: string } | null;
  employees: { full_name: string } | null;
  customer_interactions: { product_category: string | null; product_model: string | null; invoice_number: string | null } | null;
}

function responsesQuery(sb: SupabaseClient, f: AnalyticsFilters) {
  let q = sb
    .from("survey_responses")
    .select(
      "submitted_at, survey_type, nps_score, nps_category, product_satisfaction, staff_service_rating, overall_experience_rating, product_pricing_satisfaction, non_purchase_reason, other_reason_description, additional_feedback, resolution_status, customers(full_name, mobile), branches(name), employees(full_name), customer_interactions!inner(product_category, product_model, invoice_number)",
    )
    .gte("submitted_at", `${f.from}T00:00:00+05:30`)
    .lte("submitted_at", `${f.to}T23:59:59.999+05:30`)
    .order("submitted_at", { ascending: false });
  if (f.branch) q = q.eq("branch_id", f.branch);
  if (f.employee) q = q.eq("employee_id", f.employee);
  if (f.category) q = q.eq("customer_interactions.product_category", f.category);
  return q;
}

export async function buildReport(
  sb: SupabaseClient,
  actor: Profile,
  type: ReportType,
  f: AnalyticsFilters,
  branchName: string | null,
  minEmployeeSample: number,
  /** Raw query parameters, for reports with their own filters (Customer Insights). */
  extra: Record<string, string> = {},
): Promise<ReportData> {
  const meta = REPORT_TYPES.find((r) => r.value === type)!;
  const subtitle = `${formatDate(f.from)} – ${formatDate(f.to)} · ${branchName ?? "All accessible branches"}${f.surveyType ? ` · ${SURVEY_TYPE_LABELS[f.surveyType]} customers` : ""}${f.category ? ` · ${f.category}` : ""}`;
  const mobile = (m: string | null) => (canSeeContactDetails(actor) ? formatMobile(m) : maskMobile(m));
  const npsRow = (label: string, period: string, r: { total: number; promoters: number; passives: number; detractors: number; promoterPct: number | null; passivePct: number | null; detractorPct: number | null; nps: number | null }) => ({
    segment: label, period, responses: r.total, promoters: r.promoters, passives: r.passives, detractors: r.detractors,
    promoter_pct: r.promoterPct, passive_pct: r.passivePct, detractor_pct: r.detractorPct, nps: formatNps(r.nps),
  });

  switch (type) {
    case "overall_nps": {
      const o = await getOverview(sb, f);
      const trend = await getTrend(sb, f, "month");
      const rows = [
        npsRow("Overall", "Whole period", o.overall),
        npsRow("Purchased customers", "Whole period", o.purchased),
        npsRow("Non-purchased customers", "Whole period", o.nonPurchased),
        ...trend.map((t) => npsRow("Overall", formatDate(t.period, "MMM yyyy"), { total: t.responses, promoters: t.promoters, passives: t.passives, detractors: t.detractors, promoterPct: pct(t.promoters, t.responses), passivePct: pct(t.passives, t.responses), detractorPct: pct(t.detractors, t.responses), nps: t.overall })),
      ];
      return {
        title: meta.label, subtitle,
        columns: [
          { key: "segment", label: "Segment", width: 26 }, { key: "period", label: "Period", width: 16 }, { key: "responses", label: "Responses" },
          { key: "promoters", label: "Promoters" }, { key: "passives", label: "Passives" }, { key: "detractors", label: "Detractors" },
          { key: "promoter_pct", label: "% Promoters" }, { key: "passive_pct", label: "% Passives" }, { key: "detractor_pct", label: "% Detractors" }, { key: "nps", label: "NPS" },
        ],
        rows,
        notes: ["NPS = % promoters (9–10) − % detractors (0–6), from completed surveys only. N/A means no responses."],
      };
    }
    case "purchased_feedback":
    case "non_purchased_feedback":
    case "detractors": {
      const st: SurveyType | null = type === "purchased_feedback" ? "purchased" : type === "non_purchased_feedback" ? "non_purchased" : f.surveyType;
      const rows = await fetchAll<ResponseRow>((a, b) => {
        let q = responsesQuery(sb, f);
        if (st) q = q.eq("survey_type", st);
        if (type === "detractors") q = q.eq("nps_category", "detractor");
        return q.range(a, b) as unknown as PromiseLike<{ data: ResponseRow[] | null; error: { message: string } | null }>;
      });
      const base = (r: ResponseRow) => ({
        date: formatDateTime(r.submitted_at),
        customer: r.customers?.full_name ?? "—",
        mobile: mobile(r.customers?.mobile ?? null),
        branch: r.branches?.name ?? "—",
        employee: r.employees?.full_name ?? "—",
        type: SURVEY_TYPE_LABELS[r.survey_type],
        nps: r.nps_score,
        category: r.nps_category,
        staff: r.staff_service_rating,
        feedback: r.additional_feedback ?? "",
        status: RESOLUTION_LABELS[r.resolution_status],
      });
      const common = [
        { key: "date", label: "Submitted", width: 18 }, { key: "customer", label: "Customer", width: 20 }, { key: "mobile", label: "Mobile", width: 14 },
        { key: "branch", label: "Branch", width: 16 }, { key: "employee", label: "Employee", width: 18 },
      ];
      if (type === "purchased_feedback") {
        return {
          title: meta.label, subtitle,
          columns: [...common, { key: "product", label: "Product", width: 20 }, { key: "invoice", label: "Invoice" }, { key: "nps", label: "NPS" }, { key: "category", label: "Category" },
            { key: "product_sat", label: "Product satisfaction (1–5)" }, { key: "staff", label: "Staff (1–5)" }, { key: "overall", label: "Overall (1–5)" },
            { key: "feedback", label: "Feedback", width: 50 }, { key: "status", label: "Follow-up" }],
          rows: rows.map((r) => ({ ...base(r), product: [r.customer_interactions?.product_category, r.customer_interactions?.product_model].filter(Boolean).join(" · ") || "—", invoice: r.customer_interactions?.invoice_number ?? "—", product_sat: r.product_satisfaction, overall: r.overall_experience_rating })),
        };
      }
      if (type === "non_purchased_feedback") {
        return {
          title: meta.label, subtitle,
          columns: [...common, { key: "nps", label: "NPS" }, { key: "category", label: "Category" }, { key: "reason", label: "Reason for not purchasing", width: 30 },
            { key: "staff", label: "Staff (1–5)" }, { key: "pricing", label: "Availability/pricing (1–5)" }, { key: "feedback", label: "Feedback", width: 50 }, { key: "status", label: "Follow-up" }],
          rows: rows.map((r) => ({ ...base(r), reason: r.non_purchase_reason ? `${NON_PURCHASE_REASON_LABELS[r.non_purchase_reason]}${r.other_reason_description ? `: ${r.other_reason_description}` : ""}` : "—", pricing: r.product_pricing_satisfaction })),
        };
      }
      return {
        title: meta.label, subtitle,
        columns: [...common, { key: "type", label: "Customer type" }, { key: "nps", label: "NPS" }, { key: "staff", label: "Staff (1–5)" }, { key: "feedback", label: "Feedback", width: 50 }, { key: "status", label: "Follow-up" }],
        rows: rows.map(base),
      };
    }
    case "branch_performance": {
      const rows = await getBranchPerformance(sb, f);
      return {
        title: meta.label, subtitle,
        columns: [
          { key: "branch", label: "Branch", width: 20 }, { key: "invited", label: "Invited" }, { key: "dispatched", label: "SMS sent" }, { key: "delivered", label: "Delivered*" },
          { key: "completed", label: "Completed" }, { key: "rate", label: "Response rate %" }, { key: "responses", label: "Responses" }, { key: "nps", label: "NPS" },
          { key: "prom", label: "% Promoters" }, { key: "pass", label: "% Passives" }, { key: "det", label: "% Detractors" }, { key: "det_n", label: "Detractors" },
          { key: "p_nps", label: "Purchased NPS (n)" }, { key: "np_nps", label: "Non-purchased NPS (n)" }, { key: "staff", label: "Avg staff rating" },
        ],
        rows: rows.map((b) => ({
          branch: b.name, invited: b.invited, dispatched: b.dispatched, delivered: b.delivered, completed: b.completed, rate: b.responseRate, responses: b.nps.total,
          nps: formatNps(b.nps.nps), prom: b.nps.promoterPct, pass: b.nps.passivePct, det: b.nps.detractorPct, det_n: b.nps.detractors,
          p_nps: `${formatNps(b.purchased.nps)} (${b.purchased.total})`, np_nps: `${formatNps(b.nonPurchased.nps)} (${b.nonPurchased.total})`, staff: b.avgStaffRating,
        })),
        notes: ["*Delivered is only counted where the SMS provider reports delivery."],
      };
    }
    case "employee_service": {
      const rows = await getEmployeePerformance(sb, { ...f, employee: null }, minEmployeeSample);
      return {
        title: meta.label, subtitle,
        columns: [
          { key: "employee", label: "Employee", width: 20 }, { key: "branch", label: "Branch", width: 16 }, { key: "interactions", label: "Interactions" }, { key: "responses", label: "Feedback count" },
          { key: "staff", label: "Avg staff rating" }, { key: "nps", label: "Associated NPS" }, { key: "prom", label: "Promoters" }, { key: "pass", label: "Passives" }, { key: "det", label: "Detractors" },
          { key: "pos", label: "Positive comments" }, { key: "neg", label: "Negative comments" }, { key: "sample", label: "Sample" },
        ],
        rows: rows.map((e) => ({
          employee: e.name, branch: e.branchName, interactions: e.interactions, responses: e.nps.total, staff: e.avgStaffRating, nps: formatNps(e.nps.nps),
          prom: e.nps.promoters, pass: e.nps.passives, det: e.nps.detractors, pos: e.positiveComments, neg: e.negativeComments,
          sample: e.sufficientSample ? "Sufficient" : `Insufficient (< ${minEmployeeSample})`,
        })),
        notes: [
          `Employee-associated NPS reflects feedback from customers linked to the employee; it is an indicator, not a direct measure of individual performance.`,
          `Employees with fewer than ${minEmployeeSample} responses are marked insufficient and should not be ranked.`,
        ],
      };
    }
    case "rep_scorecard": {
      const reps = await getRepScorecard(sb, f, minEmployeeSample);
      const order = { graded: 0, insufficient_data: 1, low_activity: 2 } as const;
      const sorted = [...reps].sort((a, b) => order[a.status] - order[b.status] || (b.score ?? 0) - (a.score ?? 0) || a.visits - b.visits || a.name.localeCompare(b.name));
      const keys = Object.keys(KPI_WEIGHTS) as KpiKey[];
      const KPI_SHORT: Record<KpiKey, string> = { feedback: "Feedback", phones: "Devices", accessories: "Access.", conversion: "Conversion", reviews: "Reviews", process: "Steps" };
      let rank = 0;
      return {
        title: meta.label,
        subtitle,
        columns: [
          { key: "rank", label: "#" }, { key: "rep", label: "Sales rep", width: 20 }, { key: "branch", label: "Showroom", width: 16 },
          { key: "grade", label: "Grade", width: 14 }, { key: "score", label: "Score" },
          ...keys.map((k) => ({ key: `kpi_${k}`, label: `${KPI_SHORT[k]} ${KPI_WEIGHTS[k]}%` })),
          { key: "visits", label: "Visits" }, { key: "sales", label: "Sales" }, { key: "conv", label: "Conv. %" },
          { key: "android", label: "Android" }, { key: "apple", label: "Apple" }, { key: "other", label: "Other dev." },
          { key: "comm", label: "Comm. acc. Rs." }, { key: "noncomm", label: "Non-comm. acc. Rs." },
          { key: "mins", label: "Avg min" }, { key: "days", label: "Days to buy" }, { key: "steps", label: `Avg steps /${SALES_STEPS.length}` },
          { key: "reviews", label: "Reviews asked/left" }, { key: "staff", label: "Staff rating" }, { key: "nps", label: "NPS" },
          { key: "off", label: "Days off" }, { key: "unexcused", label: "Sudden, no proof" }, { key: "penalty", label: "Leave penalty" },
          { key: "status", label: "Note", width: 24 },
        ],
        rows: sorted.map((r) => ({
          rank: r.status === "graded" ? ++rank : "",
          rep: r.name,
          branch: r.branchName,
          grade: r.grade ?? (r.status === "low_activity" ? "LOW ACTIVITY" : "Not graded"),
          score: r.score,
          // KPI score columns are prefixed so they can never collide with the raw-count columns.
          ...Object.fromEntries(keys.map((k) => [`kpi_${k}`, r.components[k] === null ? "" : Math.round(r.components[k]!)])),
          visits: r.visits,
          sales: r.sales,
          conv: r.visits ? Math.round((100 * r.sales) / r.visits) : null,
          android: r.androidPhones,
          apple: r.applePhones,
          other: r.otherDevices,
          comm: r.commissionAccessoriesValue,
          noncomm: r.nonCommissionAccessoriesValue,
          mins: r.avgVisitMinutes === null ? null : Math.round(r.avgVisitMinutes),
          days: r.avgConversionDays,
          steps: r.avgSalesSteps,
          reviews: `${r.reviewsAsked}/${r.reviewsConfirmed}`,
          staff: r.avgStaffRating,
          nps: formatNps(r.nps),
          off: r.leaveDays ?? 0,
          unexcused: r.unexcusedLeaveDays ?? 0,
          penalty: r.penalty ? -r.penalty : "",
          status:
            r.status === "low_activity"
              ? `${r.visits} visit${r.visits === 1 ? "" : "s"} (needs ${MIN_GRADED_VISITS})`
              : (repStatusText(r) ?? (r.comparedWith === "company" ? "vs company avg" : "")),
        })),
        rowTone: sorted.map((r) => (r.status === "low_activity" ? "danger" : null)),
        pdfFontSize: 5.6,
        notes: [
          `KPI columns (with %) are 0-100 scores. `+
          `Grades: ${GRADE_BANDS.map((b) => (b.grade === "Fail" ? `Fail below ${GRADE_BANDS[GRADE_BANDS.length - 2].min}` : `${b.grade} ${b.min}+`)).join(", ")}. A blank KPI could not be measured: it is left out and the other weights scale up.`,
          `No targets: sales, accessories by sales value in Rs. (commission x${COMMISSION_ACCESSORY_WEIGHT}), conversion and Google reviews compare each rep with the showroom average (average = ${AVERAGE_SCORE}, one third above = 100).`,
          `LOW ACTIVITY (red): fewer than ${MIN_GRADED_VISITS} visits recorded with the scorecard fields in this period - not graded; manager to follow up (leave, new joiner, or visits not recorded).`,
          `LEAVE: device sales and accessories are compared per working day. Sudden leave without proof: -${LEAVE_PENALTY_PER_DAY} points per day on the score (max -${MAX_LEAVE_PENALTY}); informed leave and sudden leave with proof: no penalty.`,
          `Customer feedback counts only with ${minEmployeeSample}+ survey responses. Visits recorded before the scorecard was introduced, and bulk imports, are not counted.`,
        ],
      };
    }
    case "customer_insights": {
      const inf = parseInsightFilters(extra);
      const { rows, total } = await getAllCustomerInsights(sb, inf, MAX_ROWS);
      return {
        title: meta.label,
        subtitle: `${describeInsightFilters(inf, branchName)} · ${total.toLocaleString()} customers`,
        columns: [
          { key: "customer", label: "Customer", width: 22 }, { key: "mobile", label: "Mobile", width: 14 }, { key: "showrooms", label: "Showrooms", width: 20 },
          { key: "models", label: "Models bought", width: 30 }, { key: "purchases", label: "Purchases" }, { key: "visits", label: "Visits" },
          { key: "first", label: "First visit", width: 12 }, { key: "last_purchase", label: "Last purchase", width: 12 },
          { key: "surveys", label: "Surveys" }, { key: "nps", label: "Latest NPS" }, { key: "group", label: "NPS group" }, { key: "staff", label: "Avg staff rating" },
          { key: "comment", label: "Latest comment", width: 40 }, { key: "offers", label: "Offer SMS" },
        ],
        rows: rows.map((r) => ({
          customer: r.fullName,
          mobile: mobile(r.mobile),
          showrooms: r.branches.join(", "),
          models: r.models.join(", "),
          purchases: r.purchases,
          visits: r.visits,
          first: r.firstVisit ? formatDate(r.firstVisit) : "",
          last_purchase: r.lastPurchase ? formatDate(r.lastPurchase) : "",
          surveys: r.responses,
          nps: r.latestNps,
          group: r.latestNpsCategory ?? "",
          staff: r.avgStaffRating,
          comment: r.latestComment ?? "",
          offers: r.smsOptOut || r.offersOptOut ? "Stopped" : r.mobile ? "Allowed" : "No mobile",
        })),
        notes: [
          "Models bought, showrooms and counts include every visit you are allowed to see. NPS group: promoter 9–10, passive 7–8, detractor 0–6 (latest survey).",
          total > MAX_ROWS ? `Only the first ${MAX_ROWS.toLocaleString()} customers are included – narrow the filters.` : "",
        ].filter(Boolean),
      };
    }
    case "monthly_cx": {
      const [trend, rr] = await Promise.all([getTrend(sb, f, "month"), getResponseRateTrend(sb, f)]);
      const months = [...new Set([...trend.map((t) => t.period), ...rr.map((r) => r.period)])].sort();
      return {
        title: meta.label, subtitle,
        columns: [
          { key: "month", label: "Month" }, { key: "responses", label: "Responses" }, { key: "nps", label: "Overall NPS" }, { key: "p_nps", label: "Purchased NPS" }, { key: "np_nps", label: "Non-purchased NPS" },
          { key: "prom", label: "Promoters" }, { key: "pass", label: "Passives" }, { key: "det", label: "Detractors" }, { key: "sent", label: "SMS sent" }, { key: "completed", label: "Completed" }, { key: "rate", label: "Response rate %" },
        ],
        rows: months.map((m) => {
          const t = trend.find((x) => x.period === m);
          const r = rr.find((x) => x.period === m);
          return {
            month: formatDate(m, "MMM yyyy"), responses: t?.responses ?? 0, nps: formatNps(t?.overall ?? null), p_nps: formatNps(t?.purchased ?? null), np_nps: formatNps(t?.nonPurchased ?? null),
            prom: t?.promoters ?? 0, pass: t?.passives ?? 0, det: t?.detractors ?? 0, sent: r?.dispatched ?? 0, completed: r?.completed ?? 0, rate: r?.rate ?? null,
          };
        }),
        notes: ["Response rate is by invitation month: completed ÷ SMS sent for invitations created that month."],
      };
    }
    case "non_purchase_reasons": {
      const rows = await getNonPurchaseReasons(sb, f);
      return {
        title: meta.label, subtitle,
        columns: [{ key: "reason", label: "Reason", width: 34 }, { key: "responses", label: "Responses" }, { key: "share", label: "Share %" }, { key: "det", label: "Detractors" }, { key: "staff", label: "Avg staff rating" }],
        rows: rows.map((r) => ({ reason: NON_PURCHASE_REASON_LABELS[r.reason as NonPurchaseReason] ?? r.reason, responses: r.responses, share: r.share, det: r.detractors, staff: r.avgStaffRating })),
      };
    }
    case "invitation_delivery": {
      type Inv = { created_at: string; survey_type: SurveyType; status: InvitationStatus; sent_at: string | null; delivered_at: string | null; opened_at: string | null; completed_at: string | null; send_count: number; last_error: string | null; customers: { full_name: string; mobile: string | null } | null; branches: { name: string } | null };
      const rows = await fetchAll<Inv>((a, b) => {
        let q = sb
          .from("survey_invitations")
          .select("created_at, survey_type, status, sent_at, delivered_at, opened_at, completed_at, send_count, last_error, customers(full_name, mobile), branches(name)")
          .gte("created_at", `${f.from}T00:00:00+05:30`)
          .lte("created_at", `${f.to}T23:59:59.999+05:30`)
          .order("created_at", { ascending: false });
        if (f.branch) q = q.eq("branch_id", f.branch);
        if (f.employee) q = q.eq("employee_id", f.employee);
        if (f.surveyType) q = q.eq("survey_type", f.surveyType);
        return q.range(a, b) as unknown as PromiseLike<{ data: Inv[] | null; error: { message: string } | null }>;
      });
      return {
        title: meta.label, subtitle,
        columns: [
          { key: "created", label: "Created", width: 18 }, { key: "customer", label: "Customer", width: 20 }, { key: "mobile", label: "Mobile", width: 14 }, { key: "branch", label: "Branch", width: 16 },
          { key: "type", label: "Survey" }, { key: "status", label: "Status" }, { key: "sent", label: "Sent", width: 18 }, { key: "delivered", label: "Delivered*", width: 18 },
          { key: "opened", label: "Opened", width: 18 }, { key: "completed", label: "Completed", width: 18 }, { key: "sends", label: "Sends" }, { key: "error", label: "Last error", width: 30 },
        ],
        rows: rows.map((i) => ({
          created: formatDateTime(i.created_at), customer: i.customers?.full_name ?? "—", mobile: mobile(i.customers?.mobile ?? null), branch: i.branches?.name ?? "—",
          type: SURVEY_TYPE_LABELS[i.survey_type], status: INVITATION_STATUS_LABELS[i.status], sent: i.sent_at ? formatDateTime(i.sent_at) : "", delivered: i.delivered_at ? formatDateTime(i.delivered_at) : "",
          opened: i.opened_at ? formatDateTime(i.opened_at) : "", completed: i.completed_at ? formatDateTime(i.completed_at) : "", sends: i.send_count, error: i.last_error ?? "",
        })),
        notes: ["*Delivered is only recorded when the SMS provider supplies a delivery report. Opened means the survey link was loaded."],
      };
    }
  }
}
