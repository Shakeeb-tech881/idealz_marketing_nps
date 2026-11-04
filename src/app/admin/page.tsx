import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquareText, Send, Star, CheckCircle2, Percent, Smile, Meh, Frown } from "lucide-react";
import { requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { grainFor, parseFilters } from "@/lib/analytics/filters";
import { formatNps } from "@/lib/nps";
import { formatDate, formatNumber, formatPct, formatRating } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { EXPERIENCE_SCALE, NON_PURCHASE_REASON_LABELS, SATISFACTION_SCALE, STAR_SCALE, type NonPurchaseReason } from "@/lib/survey/definitions";
import {
  getBranchPerformance,
  getEmployeePerformance,
  getNonPurchaseReasons,
  getOverview,
  getRatingDistribution,
  getRecentComments,
  getResponseRateTrend,
  getTrend,
} from "@/server/services/analytics";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { FilterBar } from "@/components/admin/filter-bar";
import { KpiCard } from "@/components/admin/kpi-card";
import { Panel } from "@/components/admin/panel";
import { NpsGauge } from "@/components/charts/nps-gauge";
import { NpsBreakdown } from "@/components/charts/nps-breakdown";
import { HorizontalBarChart, NpsTrendChart, RatingDistributionChart, ResponseRateChart, SegmentComparisonChart, SegmentNpsChart } from "@/components/charts/charts";
import { NpsCategoryBadge } from "@/components/admin/badges";

export const metadata: Metadata = { title: "Dashboard" };

function periodLabel(period: string, grain: "day" | "week" | "month") {
  return grain === "month" ? formatDate(period, "MMM yy") : grain === "week" ? `Wk ${formatDate(period, "d MMM")}` : formatDate(period, "d MMM");
}

export default async function DashboardPage({ searchParams }: PageProps<"/admin">) {
  const profile = await requirePageRole();
  if (profile.role === "staff") redirect("/admin/customers");
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const grain = grainFor(filters);
  const supabase = await createClient();
  // Everything below runs in parallel – one round trip to the database.
  const settingsP = getSettings(supabase);
  const [settings, lookups, overview, trend, ratings, reasons, rr, branches, employees, recent] = await Promise.all([
    settingsP,
    getLookups(supabase, { profile }),
    getOverview(supabase, filters),
    getTrend(supabase, filters, grain),
    getRatingDistribution(supabase, filters),
    getNonPurchaseReasons(supabase, filters),
    getResponseRateTrend(supabase, filters),
    getBranchPerformance(supabase, filters),
    settingsP.then((s) => getEmployeePerformance(supabase, filters, s.min_employee_sample)),
    getRecentComments(supabase, filters, null, 5),
  ]);

  const o = overview;
  const branchNames = new Map(lookups.branches.map((b) => [b.id, b.name]));
  const emp = employees.filter((e) => e.sufficientSample && e.avgStaffRating !== null).sort((a, b) => (b.avgStaffRating ?? 0) - (a.avgStaffRating ?? 0)).slice(0, 10);
  const insufficient = employees.filter((e) => !e.sufficientSample && e.nps.total > 0).length;
  const sentimentTotal = o.comments.total;

  return (
    <>
      <PageHeader
        title="Executive dashboard"
        description={`Customer experience across ${filters.branch ? branchNames.get(filters.branch) ?? "the selected branch" : profile.role === "branch_manager" ? "your branch" : "all branches"} · ${formatDate(filters.from)} – ${formatDate(filters.to)}`}
      />
      <FilterBar options={{ branches: lookups.branches, employees: lookups.employees }} values={filters} />

      {/* KPI row */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
        <Panel title="Overall NPS" description={`Completed surveys · n = ${formatNumber(o.overall.total)}`}>
          <div className="flex flex-col items-center gap-5">
            <NpsGauge nps={o.overall.nps} />
            <NpsBreakdown result={o.overall} />
          </div>
        </Panel>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <KpiCard label="Purchased NPS" accent="series-1" value={formatNps(o.purchased.nps)} sub={`n = ${formatNumber(o.purchased.total)} purchased customers`} />
          <KpiCard label="Non-purchased NPS" accent="series-2" value={formatNps(o.nonPurchased.nps)} sub={`n = ${formatNumber(o.nonPurchased.total)} non-purchased`} />
          <KpiCard label="Avg staff service" icon={Star} value={o.avgStaffRating === null ? "N/A" : `${formatRating(o.avgStaffRating)} / 5`} sub={`From ${formatNumber(o.overall.total)} ratings`} />
          <KpiCard label="Survey invitations" icon={Send} value={formatNumber(o.invitations)} sub={`${formatNumber(o.dispatched)} SMS sent · ${formatNumber(o.failed)} failed`} />
          <KpiCard label="Completed surveys" icon={CheckCircle2} value={formatNumber(o.overall.total)} sub="Submitted in this period" />
          <KpiCard label="Response rate" icon={Percent} value={formatPct(o.responseRate)} sub={`${formatNumber(o.completed)} of ${formatNumber(o.dispatched)} sent invitations`} />
          <KpiCard label="Promoters" accent="promoter" icon={Smile} value={formatNumber(o.overall.promoters)} sub={`${formatPct(o.overall.promoterPct)} of responses`} />
          <KpiCard label="Passives" accent="passive" icon={Meh} value={formatNumber(o.overall.passives)} sub={`${formatPct(o.overall.passivePct)} of responses`} />
          <KpiCard label="Detractors" accent="detractor" icon={Frown} value={formatNumber(o.overall.detractors)} sub={`${formatPct(o.overall.detractorPct)} of responses`} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="NPS trend" description={`By ${grain} · overall and by customer type`}>
          <NpsTrendChart
            data={trend.map((t) => ({ ...t, label: periodLabel(t.period, grain) }))}
            segments={!filters.surveyType}
          />
        </Panel>
        <Panel title="Purchased vs non-purchased" description="NPS by customer type (separate populations)">
          <SegmentComparisonChart purchased={{ nps: o.purchased.nps, n: o.purchased.total }} nonPurchased={{ nps: o.nonPurchased.nps, n: o.nonPurchased.total }} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel
          title="Branch NPS"
          description={`Faded bars have fewer than ${settings.min_branch_sample} responses`}
          actions={<Link href="/admin/branches" className="text-xs font-medium text-series-1 hover:underline">Details</Link>}
        >
          <SegmentNpsChart data={branches.map((b) => ({ name: b.name, nps: b.nps.nps, n: b.nps.total, reliable: b.nps.total >= settings.min_branch_sample }))} />
        </Panel>
        <Panel
          title="Employee service ratings"
          description={`Average staff rating (1–5) · only employees with ≥ ${settings.min_employee_sample} responses${insufficient ? ` · ${insufficient} with too few responses not shown` : ""}`}
          actions={<Link href="/admin/employees" className="text-xs font-medium text-series-1 hover:underline">Details</Link>}
        >
          <HorizontalBarChart
            color="#2a78d6"
            valueLabel="Avg staff rating"
            data={emp.map((e) => ({ name: e.name, value: Number(e.avgStaffRating?.toFixed(2)), sub: `n = ${e.nps.total} · ${e.branchName}` }))}
          />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Product satisfaction" description="Purchased customers · Q2">
          <RatingDistributionChart counts={ratings.product_satisfaction} labels={SATISFACTION_SCALE.map((s) => `${s.emoji}`)} />
        </Panel>
        <Panel title="Overall purchasing experience" description="Purchased customers · Q4">
          <RatingDistributionChart counts={ratings.overall_experience_rating} labels={EXPERIENCE_SCALE.map((s) => `${s.emoji}`)} />
        </Panel>
        <Panel title="Staff service rating" description="All customers · stars">
          <RatingDistributionChart counts={ratings.staff_service_rating} labels={STAR_SCALE.map((s) => `${s.value}★`)} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Reasons for not purchasing" description="Non-purchased customers · main reason">
          <HorizontalBarChart data={reasons.map((r) => ({ name: NON_PURCHASE_REASON_LABELS[r.reason as NonPurchaseReason] ?? r.reason, value: r.responses, sub: `${formatPct(r.share)} of non-purchased responses` }))} />
        </Panel>
        <Panel title="Monthly response rate" description="Completed ÷ SMS sent, by invitation month">
          <ResponseRateChart data={rr.map((r) => ({ ...r, label: formatDate(r.period, "MMM yy") }))} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title="Feedback sentiment" description="Indicative · based on the NPS score of customers who left a comment">
          {sentimentTotal === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No written feedback in this period</p>
          ) : (
            <div className="space-y-4 pt-2">
              {[
                { label: "Positive (promoters)", n: o.comments.promoter, cls: "bg-promoter" },
                { label: "Neutral (passives)", n: o.comments.passive, cls: "bg-passive" },
                { label: "Negative (detractors)", n: o.comments.detractor, cls: "bg-detractor" },
              ].map((s) => (
                <div key={s.label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{s.label}</span>
                    <span className="font-semibold tabular">
                      {s.n} <span className="font-normal text-muted-foreground">· {formatPct(Math.round((s.n / sentimentTotal) * 1000) / 10)}</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className={`h-2 rounded-full ${s.cls}`} style={{ width: `${(s.n / sentimentTotal) * 100}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{formatNumber(sentimentTotal)} comments in this period.</p>
            </div>
          )}
        </Panel>
        <Panel
          className="xl:col-span-2"
          title="Latest customer comments"
          actions={<Link href="/admin/feedback" className="text-xs font-medium text-series-1 hover:underline">Open inbox</Link>}
        >
          {recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No comments yet</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((c) => (
                <li key={c.id} className="py-3">
                  <Link href={`/admin/feedback/${c.id}`} className="group block">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <NpsCategoryBadge category={c.nps_category} score={c.nps_score} />
                      <span>{c.survey_type === "purchased" ? "Purchased" : "Non-purchased"}</span>
                      <span>·</span>
                      <span>{branchNames.get(c.branch_id) ?? ""}</span>
                      <span>·</span>
                      <span>{formatDate(c.submitted_at)}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-foreground group-hover:underline">{c.additional_feedback}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
        <MessageSquareText className="size-3.5" />
        NPS = % promoters − % detractors from completed surveys only. “N/A” means no responses (not zero). Response rate counts invitations created in the period.
      </p>
    </>
  );
}
