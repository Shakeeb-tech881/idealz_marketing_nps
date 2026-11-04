import type { Metadata } from "next";
import { Lightbulb } from "lucide-react";
import { requirePageRole, MANAGERS } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/analytics/filters";
import { countThemes } from "@/lib/analytics/themes";
import { buildInsights } from "@/lib/analytics/insights";
import { formatNps } from "@/lib/nps";
import { formatDate, formatNumber, formatPct, formatRating } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { EXPERIENCE_SCALE, NON_PURCHASE_REASON_LABELS, SATISFACTION_SCALE, STAR_SCALE, type NonPurchaseReason } from "@/lib/survey/definitions";
import { getBranchPerformance, getDrivers, getNonPurchaseReasons, getNpsDistribution, getOverview, getRatingDistribution, getTrend } from "@/server/services/analytics";
import { rpcArgs } from "@/lib/analytics/filters";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { FilterBar } from "@/components/admin/filter-bar";
import { Panel } from "@/components/admin/panel";
import { KpiCard } from "@/components/admin/kpi-card";
import { NpsBreakdown } from "@/components/charts/nps-breakdown";
import { HorizontalBarChart, NpsScoreChart, NpsTrendChart, RatingDistributionChart } from "@/components/charts/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "NPS & insights" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/admin/analytics">) {
  const profile = await requirePageRole(MANAGERS);
  const sp = await searchParams;
  const filters = parseFilters(sp, "365d");
  const supabase = await createClient();
  const settings = await getSettings(supabase);

  const purchasedF = { ...filters, surveyType: "purchased" as const };
  const nonPurchasedF = { ...filters, surveyType: "non_purchased" as const };

  const [lookups, overview, scoreDist, trend, ratingsP, ratingsN, reasons, branches, drivers, comments] = await Promise.all([
    getLookups(supabase, { profile }),
    getOverview(supabase, filters),
    getNpsDistribution(supabase, filters),
    getTrend(supabase, filters, "month"),
    getRatingDistribution(supabase, purchasedF),
    getRatingDistribution(supabase, nonPurchasedF),
    getNonPurchaseReasons(supabase, filters),
    getBranchPerformance(supabase, filters),
    getDrivers(supabase, filters),
    supabase.rpc("cx_responses", rpcArgs(filters)).select("additional_feedback, nps_category, survey_type").not("additional_feedback", "is", null).order("submitted_at", { ascending: false }).limit(3000),
  ]);

  const commentRows = (comments.data ?? []) as { additional_feedback: string; nps_category: string; survey_type: string }[];
  const allThemes = countThemes(commentRows);
  const detractorThemes = countThemes(commentRows.filter((c) => c.nps_category === "detractor"));
  const promoterThemes = countThemes(commentRows.filter((c) => c.nps_category === "promoter"));
  const purchasedThemes = countThemes(commentRows.filter((c) => c.survey_type === "purchased"));
  const nonPurchasedThemes = countThemes(commentRows.filter((c) => c.survey_type === "non_purchased"));
  const insights = buildInsights({
    overall: overview.overall,
    promoterThemes,
    detractorThemes,
    allThemes,
    commentsAnalysed: commentRows.length,
    reasons,
    branches: branches.map((b) => ({ name: b.name, nps: b.nps })),
    minBranchSample: settings.min_branch_sample,
    drivers,
    monthly: trend.map((t) => ({ period: t.period, overall: t.overall, responses: t.responses })),
  });

  const showType = !filters.surveyType;

  return (
    <>
      <PageHeader title="NPS & marketing insights" description="Customer loyalty, satisfaction drivers and reasons for not purchasing — purchased and non-purchased customers are always analysed separately." />
      <FilterBar options={{ branches: lookups.branches, employees: lookups.employees }} values={filters} defaultRange="365d" />

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Overall", r: overview.overall, accent: "brand" as const },
          { label: "Purchased customers", r: overview.purchased, accent: "series-1" as const },
          { label: "Non-purchased customers", r: overview.nonPurchased, accent: "series-2" as const },
        ].map((s) => (
          <Panel key={s.label} title={<span className="flex items-center gap-2"><span className={cn("size-2 rounded-full", s.accent === "brand" ? "bg-brand" : s.accent === "series-1" ? "bg-series-1" : "bg-series-2")} />{s.label}</span>} description={`n = ${formatNumber(s.r.total)} completed surveys`}>
            <p className="mb-3 text-3xl font-semibold tabular">{formatNps(s.r.nps)}</p>
            <NpsBreakdown result={s.r} />
          </Panel>
        ))}
      </div>

      <Panel className="mt-4" title={<span className="flex items-center gap-2"><Lightbulb className="size-4 text-passive" /> Key questions answered</span>} description="Generated from the filtered data. Theme detection is keyword-based and indicative.">
        <div className="grid gap-3 md:grid-cols-2">
          {insights.map((ins) => (
            <div key={ins.question} className={cn("rounded-lg border-l-4 bg-muted/40 p-3", ins.tone === "good" ? "border-promoter" : ins.tone === "warn" ? "border-passive" : "border-slate-300")}>
              <p className="text-xs font-semibold text-muted-foreground">{ins.question}</p>
              <p className="mt-1 text-sm text-foreground">{ins.answer}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{ins.basis}</p>
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="NPS score distribution" description="How customers answered the 0–10 question">
          <NpsScoreChart data={scoreDist} />
        </Panel>
        <Panel title="Monthly NPS trend" description="Overall and by customer type">
          <NpsTrendChart data={trend.map((t) => ({ ...t, label: formatDate(t.period, "MMM yy") }))} segments={showType} />
        </Panel>
      </div>

      <h2 className="mt-8 mb-3 flex items-center gap-2 text-lg font-semibold"><span className="size-2.5 rounded-full bg-series-1" /> Purchased customer analysis</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Product satisfaction"><RatingDistributionChart height={180} counts={ratingsP.product_satisfaction} labels={SATISFACTION_SCALE.map((s) => s.emoji!)} /></Panel>
        <Panel title="Staff service"><RatingDistributionChart height={180} counts={ratingsP.staff_service_rating} labels={STAR_SCALE.map((s) => `${s.value}★`)} /></Panel>
        <Panel title="Purchasing experience"><RatingDistributionChart height={180} counts={ratingsP.overall_experience_rating} labels={EXPERIENCE_SCALE.map((s) => s.emoji!)} /></Panel>
        <Panel title="Comment themes" description="Purchased customers · indicative">
          <HorizontalBarChart color="#2a78d6" valueLabel="Comments" data={purchasedThemes.slice(0, 6).map((t) => ({ name: t.label, value: t.total, sub: `${t.promoters} promoters · ${t.detractors} detractors` }))} />
        </Panel>
      </div>

      <h2 className="mt-8 mb-3 flex items-center gap-2 text-lg font-semibold"><span className="size-2.5 rounded-full bg-series-2" /> Non-purchased customer analysis</h2>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Reasons for not purchasing" description="Main reason selected (single choice)">
          <HorizontalBarChart data={reasons.map((r) => ({ name: NON_PURCHASE_REASON_LABELS[r.reason as NonPurchaseReason] ?? r.reason, value: r.responses, sub: `${formatPct(r.share)} · ${r.detractors} detractors · staff ${formatRating(r.avgStaffRating)}` }))} />
        </Panel>
        <Panel title="Availability, pricing & offers"><RatingDistributionChart counts={ratingsN.product_pricing_satisfaction} labels={SATISFACTION_SCALE.map((s) => s.emoji!)} /></Panel>
        <Panel title="Staff service (non-purchased)"><RatingDistributionChart counts={ratingsN.staff_service_rating} labels={STAR_SCALE.map((s) => `${s.value}★`)} /></Panel>
        <Panel className="xl:col-span-2" title="Comment themes" description="Non-purchased customers — includes future purchase intent and competitor mentions · indicative">
          <HorizontalBarChart valueLabel="Comments" data={nonPurchasedThemes.slice(0, 8).map((t) => ({ name: t.label, value: t.total, sub: `${t.detractors} from detractors` }))} />
        </Panel>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Drivers of NPS</h2>
      <Panel title="Average ratings by NPS category" description="Larger gaps between promoters and detractors indicate factors associated with loyalty (association, not proven cause).">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Responses</TableHead>
                <TableHead className="text-right">Staff service</TableHead>
                <TableHead className="text-right">Product satisfaction</TableHead>
                <TableHead className="text-right">Purchasing experience</TableHead>
                <TableHead className="text-right">Availability & pricing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["promoter", "passive", "detractor"] as const).map((c) => {
                const d = drivers.find((x) => x.category === c);
                return (
                  <TableRow key={c}>
                    <TableCell className="font-medium capitalize">{c}s</TableCell>
                    <TableCell className="text-right tabular">{d?.responses ?? 0}</TableCell>
                    <TableCell className="text-right tabular">{formatRating(d?.staff)}</TableCell>
                    <TableCell className="text-right tabular">{formatRating(d?.product)}</TableCell>
                    <TableCell className="text-right tabular">{formatRating(d?.overall)}</TableCell>
                    <TableCell className="text-right tabular">{formatRating(d?.pricing)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Most common topics in detractor feedback" description={`Keyword themes · ${detractorThemes.reduce((s, t) => Math.max(s, t.total), 0) ? "" : "no detractor comments"}`}>
          <HorizontalBarChart color="#d03b3b" valueLabel="Detractor comments" data={detractorThemes.slice(0, 8).map((t) => ({ name: t.label, value: t.total }))} />
        </Panel>
        <Panel title="Month by month" description="Responses and NPS per month">
          <div className="max-h-80 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Responses</TableHead>
                  <TableHead className="text-right">Overall</TableHead>
                  <TableHead className="text-right">Purchased</TableHead>
                  <TableHead className="text-right">Non-purchased</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...trend].reverse().map((t) => (
                  <TableRow key={t.period}>
                    <TableCell>{formatDate(t.period, "MMMM yyyy")}</TableCell>
                    <TableCell className="text-right tabular">{t.responses}</TableCell>
                    <TableCell className="text-right font-medium tabular">{formatNps(t.overall)}</TableCell>
                    <TableCell className="text-right tabular">{formatNps(t.purchased)} <span className="text-xs text-muted-foreground">({t.purchasedResponses})</span></TableCell>
                    <TableCell className="text-right tabular">{formatNps(t.nonPurchased)} <span className="text-xs text-muted-foreground">({t.nonPurchasedResponses})</span></TableCell>
                  </TableRow>
                ))}
                {trend.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No responses in this period</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </Panel>
      </div>
      <KpiCard className="mt-4" label="Comments analysed for themes" value={formatNumber(commentRows.length)} sub="Most recent 3,000 comments in the filtered period. AI sentiment analysis is not enabled; themes use transparent keyword matching." />
    </>
  );
}
