import type { Metadata } from "next";
import { AlertTriangle, Award, Download, Info } from "lucide-react";
import { MANAGERS, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/analytics/filters";
import { getSettings } from "@/lib/settings";
import { formatNps } from "@/lib/nps";
import { formatRating } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AVERAGE_SCORE, COMMISSION_ACCESSORY_WEIGHT, GRADE_BANDS, KPI_LABELS, KPI_WEIGHTS, MIN_GRADED_VISITS, repStatusText, type Grade, type KpiKey, type RepScore } from "@/lib/kpi";
import { SALES_STEPS } from "@/lib/types";
import { getRepScorecard } from "@/server/services/analytics";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { FilterBar } from "@/components/admin/filter-bar";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Rep scorecard" };

const KPI_KEYS = Object.keys(KPI_WEIGHTS) as KpiKey[];

const GRADE_STYLE: Record<Grade, string> = {
  "A+": "bg-promoter-soft text-[#087a08]",
  A: "bg-promoter-soft text-[#087a08]",
  "B+": "bg-blue-50 text-blue-800",
  B: "bg-blue-50 text-blue-800",
  "C+": "bg-passive-soft text-[#8a5f00]",
  C: "bg-passive-soft text-[#8a5f00]",
  Fail: "bg-detractor-soft text-[#a52727]",
};

function LowActivityBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-detractor-soft px-2 py-0.5 text-xs font-bold whitespace-nowrap text-[#a52727]">
      <AlertTriangle className="size-3" aria-hidden /> Low activity
    </span>
  );
}

function GradeBadge({ grade }: { grade: Grade | null }) {
  if (!grade) return <span className="text-xs text-muted-foreground">Not graded</span>;
  return <span className={cn("inline-flex min-w-10 justify-center rounded-full px-2 py-0.5 text-xs font-bold", GRADE_STYLE[grade])}>{grade}</span>;
}

const fmt = (n: number | null, digits = 0) => (n === null ? "—" : n.toFixed(digits));

function RepCell({ r }: { r: RepScore }) {
  return (
    <TableCell>
      <p className="font-medium">
        {r.name}
        {!r.isActive && <span className="ml-2 text-[10px] text-muted-foreground uppercase">Inactive</span>}
      </p>
      <p className="text-xs text-muted-foreground">{r.branchName}</p>
    </TableCell>
  );
}

export default async function ScorecardPage({ searchParams }: PageProps<"/admin/scorecard">) {
  const profile = await requirePageRole(MANAGERS);
  const sp = await searchParams;
  const filters = parseFilters(sp, "30d");
  const supabase = await createClient();
  const settings = await getSettings(supabase);
  const [lookups, reps] = await Promise.all([
    getLookups(supabase, { profile }),
    getRepScorecard(supabase, filters, settings.min_employee_sample),
  ]);

  const graded = reps.filter((r) => r.grade !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
  const byVisits = (a: RepScore, b: RepScore) => a.visits - b.visits || a.name.localeCompare(b.name);
  const lowActivity = reps.filter((r) => r.status === "low_activity").sort(byVisits);
  const insufficient = reps.filter((r) => r.status === "insufficient_data").sort(byVisits);
  const pdfParams = new URLSearchParams({ type: "rep_scorecard", format: "pdf", range: "custom", from: filters.from, to: filters.to });
  if (filters.branch) pdfParams.set("branch", filters.branch);
  const byGrade = new Map<Grade, number>();
  for (const r of graded) byGrade.set(r.grade!, (byGrade.get(r.grade!) ?? 0) + 1);
  const activity = [...graded, ...insufficient, ...lowActivity];

  return (
    <>
      <PageHeader
        title="Sales rep scorecard"
        description="Grades each salesperson A+ to Fail from sales, accessories, conversion, Google reviews, sales steps and customer feedback."
        actions={
          <a href={`/api/reports?${pdfParams.toString()}`} className={buttonVariants({ variant: "outline" })}>
            <Download data-icon="inline-start" /> Download PDF
          </a>
        }
      />

      <div className="mb-4 flex gap-3 rounded-xl border border-series-1/20 bg-blue-50/60 p-4 text-sm text-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-series-1" />
        <div className="space-y-1.5">
          <p>
            <strong>No targets needed.</strong> Device sales, accessories, conversion rate and Google reviews compare each rep with the average rep in the same showroom for this period: matching the average scores {AVERAGE_SCORE}, a third above average scores 100. Showrooms with fewer than two graded reps compare against the whole company.
          </p>
          <p className="text-muted-foreground">
            Weights: {KPI_KEYS.map((k) => `${KPI_LABELS[k]} ${KPI_WEIGHTS[k]}%`).join(" · ")}. Commission accessories count {COMMISSION_ACCESSORY_WEIGHT}×. Customer feedback = staff rating (60%) + NPS (40%), only with ≥ {settings.min_employee_sample} survey responses. Sales steps = share of the {SALES_STEPS.length} steps ticked per visit. A KPI that can&apos;t be measured is left out and the others scale up.
          </p>
          <p className="text-muted-foreground">
            Grades: {GRADE_BANDS.map((b) => (b.grade === "Fail" ? `Fail < ${GRADE_BANDS[GRADE_BANDS.length - 2].min}` : `${b.grade} ≥ ${b.min}`)).join(" · ")}. A rep with fewer than {MIN_GRADED_VISITS} tracked visits in the period is flagged <strong className="text-[#a52727]">Low activity</strong> instead of graded, so the manager can follow up. Only visits recorded with the scorecard fields count; older and imported visits are left out.
          </p>
        </div>
      </div>

      <FilterBar options={{ branches: lookups.branches, employees: lookups.employees }} values={filters} show={["range", "branch"]} />

      {reps.length === 0 ? (
        <Panel>
          <EmptyState icon={Award} title="No sales reps yet" description="Add employees in Settings and pick the salesperson when recording a purchase or visit." />
        </Panel>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
            {GRADE_BANDS.map((b) => (
              <div key={b.grade} className="rounded-xl border border-border bg-card p-3 text-center">
                <GradeBadge grade={b.grade} />
                <p className="mt-1.5 text-xl font-semibold tabular">{byGrade.get(b.grade) ?? 0}</p>
              </div>
            ))}
            <div className="rounded-xl border border-detractor/30 bg-card p-3 text-center">
              <LowActivityBadge />
              <p className="mt-1.5 text-xl font-semibold tabular text-[#a52727]">{lowActivity.length}</p>
            </div>
          </div>

          <Panel title="Grades" description="Ranked by overall score. Each KPI column is a 0–100 score." bodyClassName="px-0 pb-0">
            {graded.length === 0 ? (
              <EmptyState title="No rep can be graded yet" description={`Reps are graded once they have ${MIN_GRADED_VISITS} visits recorded with the scorecard fields in this period.`} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-12 pl-5">Rank</TableHead>
                      <TableHead>Sales rep</TableHead>
                      <TableHead className="text-center">Grade</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      {KPI_KEYS.map((k) => (
                        <TableHead key={k} className="text-right whitespace-nowrap">
                          {KPI_LABELS[k]} <span className="font-normal text-muted-foreground">{KPI_WEIGHTS[k]}%</span>
                        </TableHead>
                      ))}
                      <TableHead className="pr-5">Compared with</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {graded.map((r, i) => (
                      <TableRow key={r.employeeId}>
                        <TableCell className="pl-5 tabular text-muted-foreground">{i + 1}</TableCell>
                        <RepCell r={r} />
                        <TableCell className="text-center"><GradeBadge grade={r.grade} /></TableCell>
                        <TableCell className="text-right font-semibold tabular">{fmt(r.score, 1)}</TableCell>
                        {KPI_KEYS.map((k) => (
                          <TableCell key={k} className="text-right tabular">{fmt(r.components[k])}</TableCell>
                        ))}
                        <TableCell className="pr-5 text-xs text-muted-foreground">{r.comparedWith === "branch" ? "Showroom" : "Company"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>

          {lowActivity.length > 0 && (
            <Panel
              className="mt-4 border-detractor/30"
              title={<span className="inline-flex items-center gap-2"><LowActivityBadge /> Needs follow-up</span>}
              description={`Fewer than ${MIN_GRADED_VISITS} visits recorded with the scorecard fields in this period. Check whether the rep was on leave, is new, or is not recording visits.`}
              bodyClassName="px-0 pb-0"
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    {lowActivity.map((r) => (
                      <TableRow key={r.employeeId}>
                        <RepCell r={r} />
                        <TableCell className="pr-5 text-right text-sm font-medium text-[#a52727]">{repStatusText(r)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          )}

          {insufficient.length > 0 && (
            <Panel className="mt-4" title="Not graded yet" description="Enough visits, but too few KPIs can be measured yet for a fair grade." bodyClassName="px-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    {insufficient.map((r) => (
                      <TableRow key={r.employeeId}>
                        <RepCell r={r} />
                        <TableCell className="pr-5 text-right text-sm text-muted-foreground">{repStatusText(r)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          )}

          <Panel className="mt-4" title="Sales activity" description="Totals from tracked visits in this period." bodyClassName="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-5">Sales rep</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Conversion</TableHead>
                    <TableHead className="text-right">Android</TableHead>
                    <TableHead className="text-right">Apple</TableHead>
                    <TableHead className="text-right">Other devices</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Commission acc.</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Non-comm. acc.</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Avg time with customer</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Avg days to buy</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Sales steps</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Reviews asked / left</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Staff rating</TableHead>
                    <TableHead className="pr-5 text-right">NPS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activity.map((r) => (
                    <TableRow key={r.employeeId}>
                      <TableCell className="pl-5">
                        <p className="flex items-center gap-2 font-medium">{r.name} {r.status === "low_activity" ? <LowActivityBadge /> : <GradeBadge grade={r.grade} />}</p>
                        <p className="text-xs text-muted-foreground">{r.branchName}</p>
                      </TableCell>
                      <TableCell className="text-right tabular">{r.visits}</TableCell>
                      <TableCell className="text-right tabular">{r.sales}</TableCell>
                      <TableCell className="text-right tabular">{r.visits ? `${Math.round((100 * r.sales) / r.visits)}%` : "—"}</TableCell>
                      <TableCell className="text-right tabular">{r.androidPhones}</TableCell>
                      <TableCell className="text-right tabular">{r.applePhones}</TableCell>
                      <TableCell className="text-right tabular">{r.otherDevices}</TableCell>
                      <TableCell className="text-right tabular">{r.commissionAccessories}</TableCell>
                      <TableCell className="text-right tabular">{r.nonCommissionAccessories}</TableCell>
                      <TableCell className="text-right tabular" title={`${r.timedVisits} visits with times recorded`}>{r.avgVisitMinutes === null ? "—" : `${Math.round(r.avgVisitMinutes)} min`}</TableCell>
                      <TableCell className="text-right tabular" title={`${r.measuredConversions} sales measured · 0 = bought on the first visit`}>{r.avgConversionDays === null ? "—" : `${r.avgConversionDays} d`}</TableCell>
                      <TableCell className="text-right tabular">{r.avgSalesSteps === null ? "—" : `${r.avgSalesSteps.toFixed(1)} / ${SALES_STEPS.length}`}</TableCell>
                      <TableCell className="text-right tabular">{r.reviewsAsked} / {r.reviewsConfirmed}</TableCell>
                      <TableCell className="text-right tabular" title={`${r.feedbackResponses} survey responses`}>{formatRating(r.avgStaffRating)}</TableCell>
                      <TableCell className="pr-5 text-right tabular">{formatNps(r.nps)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
        </>
      )}
    </>
  );
}
