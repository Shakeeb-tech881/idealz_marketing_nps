import type { Metadata } from "next";
import { AlertTriangle, Award, Building2, Download, Info, UserCog } from "lucide-react";
import { MANAGERS, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/analytics/filters";
import { getSettings } from "@/lib/settings";
import { formatNps } from "@/lib/nps";
import { formatLKR, formatRating } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AVERAGE_SCORE, COMMISSION_ACCESSORY_WEIGHT, GRADE_BANDS, KPI_LABELS, KPI_WEIGHTS, LEAVE_PENALTY_PER_DAY, LOW_RECORDING_RATE, MANAGER_WEIGHTS, MAX_LEAVE_PENALTY, MIN_GRADED_VISITS, repStatusText, type BranchScore, type Grade, type KpiKey, type ManagerScore, type RepScore } from "@/lib/kpi";
import { SALES_STEPS } from "@/lib/types";
import { getScorecard } from "@/server/services/analytics";
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

function BranchPanel({ graded, other }: { graded: BranchScore[]; other: BranchScore[] }) {
  const managersOf = (b: BranchScore) => (b.managers.length ? `Manager: ${b.managers.join(", ")}` : "No branch manager set");
  return (
    <Panel
      className="mb-4"
      title={<span className="inline-flex items-center gap-2"><Building2 className="size-4 text-series-1" aria-hidden /> Branch results</span>}
      description={`Every branch compared with the average branch (= ${AVERAGE_SCORE}). Sales, accessories and reviews are per staff working day, so bigger branches don't win just by size. This is ${MANAGER_WEIGHTS.branch}% of the branch manager's grade. The branch filter does not apply here.`}
      bodyClassName="px-0 pb-0"
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-12 pl-5">Rank</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead className="text-center">Grade</TableHead>
              <TableHead className="text-right">Score</TableHead>
              {KPI_KEYS.map((k) => (
                <TableHead key={k} className="text-right whitespace-nowrap">
                  {KPI_LABELS[k]} <span className="font-normal text-muted-foreground">{KPI_WEIGHTS[k]}%</span>
                </TableHead>
              ))}
              <TableHead className="text-right whitespace-nowrap">Staff</TableHead>
              <TableHead className="text-right whitespace-nowrap">Visits</TableHead>
              <TableHead className="pr-5 text-right whitespace-nowrap">Sales</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...graded, ...other].map((b, i) => (
              <TableRow key={b.branchId}>
                <TableCell className="pl-5 tabular text-muted-foreground">{b.grade ? i + 1 : ""}</TableCell>
                <TableCell>
                  <p className="font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{managersOf(b)}</p>
                  {b.note && <p className="mt-1 max-w-64 text-xs text-muted-foreground italic">{b.note}</p>}
                </TableCell>
                <TableCell className="text-center">{b.status === "low_activity" ? <LowActivityBadge /> : <GradeBadge grade={b.grade} />}</TableCell>
                <TableCell className="text-right font-semibold tabular">{fmt(b.score, 1)}</TableCell>
                {KPI_KEYS.map((k) => (
                  <TableCell key={k} className="text-right tabular">{fmt(b.components[k])}</TableCell>
                ))}
                <TableCell className="text-right tabular" title={`${b.staffDays} staff working days`}>{b.staffCount}</TableCell>
                <TableCell className="text-right tabular">{b.visits}</TableCell>
                <TableCell className="pr-5 text-right tabular">{b.sales}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}

function ManagerPanel({ managers }: { managers: ManagerScore[] }) {
  const graded = managers.filter((m) => m.grade !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
  const other = managers.filter((m) => m.grade === null).sort((a, b) => a.branchName.localeCompare(b.branchName) || a.name.localeCompare(b.name));
  return (
    <Panel
      className="mb-4"
      title={<span className="inline-flex items-center gap-2"><UserCog className="size-4 text-series-1" aria-hidden /> Branch managers – {MANAGER_WEIGHTS.branch}% branch + {MANAGER_WEIGHTS.own}% own sales</span>}
      description={`Branch result (below) counts ${MANAGER_WEIGHTS.branch}%. Own sales count ${MANAGER_WEIGHTS.own}%: the manager's own visits scored exactly like a sales rep, compared with the branch's graded reps (the whole company's when the branch has fewer than two). Then ${LEAVE_PENALTY_PER_DAY} points off per day of the manager's sudden leave without proof (at most ${MAX_LEAVE_PENALTY}). A grade needs both parts.`}
      bodyClassName="px-0 pb-0"
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-12 pl-5">Rank</TableHead>
              <TableHead>Branch manager</TableHead>
              <TableHead className="text-center">Grade</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right whitespace-nowrap">Branch result <span className="font-normal text-muted-foreground">{MANAGER_WEIGHTS.branch}%</span></TableHead>
              <TableHead className="text-right whitespace-nowrap">Own sales <span className="font-normal text-muted-foreground">{MANAGER_WEIGHTS.own}%</span></TableHead>
              {KPI_KEYS.map((k) => (
                <TableHead key={k} className="text-right whitespace-nowrap" title={`Own ${KPI_LABELS[k].toLowerCase()} score (${KPI_WEIGHTS[k]}% of own sales)`}>
                  Own {KPI_LABELS[k].toLowerCase()}
                </TableHead>
              ))}
              <TableHead className="text-right whitespace-nowrap">Own visits</TableHead>
              <TableHead className="text-right whitespace-nowrap">Own sales</TableHead>
              <TableHead className="text-right whitespace-nowrap">Days off</TableHead>
              <TableHead className="pr-5 text-right whitespace-nowrap">Leave penalty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...graded, ...other].map((m, i) => (
              <TableRow key={`${m.employeeId ?? m.name}-${m.branchId}`}>
                <TableCell className="pl-5 tabular text-muted-foreground">{m.grade ? i + 1 : ""}</TableCell>
                <TableCell>
                  <p className="font-medium">
                    {m.name}
                    {!m.isActive && <span className="ml-2 text-[10px] text-muted-foreground uppercase">Inactive</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.branchName}{m.own?.comparedWith ? ` · own sales vs ${m.own.comparedWith === "branch" ? "branch reps" : "company reps"}` : ""}</p>
                  {m.note && <p className="mt-1 max-w-72 text-xs text-muted-foreground italic">{m.note}</p>}
                </TableCell>
                <TableCell className="text-center">{m.status === "low_activity" ? <LowActivityBadge /> : <GradeBadge grade={m.grade} />}</TableCell>
                <TableCell className="text-right font-semibold tabular" title={m.penalty && m.scoreBeforePenalty !== null ? `${fmt(m.scoreBeforePenalty, 1)} before the leave penalty` : undefined}>{fmt(m.score, 1)}</TableCell>
                <TableCell className="text-right tabular">{fmt(m.branchScore, 1)}</TableCell>
                <TableCell className="text-right tabular">{fmt(m.ownScore, 1)}</TableCell>
                {KPI_KEYS.map((k) => (
                  <TableCell key={k} className="text-right tabular text-muted-foreground">{fmt(m.own?.components[k] ?? null)}</TableCell>
                ))}
                <TableCell className="text-right tabular">{m.own ? m.own.visits : "—"}</TableCell>
                <TableCell className="text-right tabular">{m.own ? m.own.sales : "—"}</TableCell>
                <TableCell className="text-right tabular" title={`Informed ${m.leave.informed} · sudden with proof ${m.leave.suddenProof} · sudden without proof ${m.leave.suddenNoProof}`}>
                  {m.leave.informed + m.leave.suddenProof + m.leave.suddenNoProof}
                  {m.leave.suddenNoProof > 0 && <span className="ml-1 text-xs font-bold text-[#a52727]">({m.leave.suddenNoProof} no proof)</span>}
                </TableCell>
                <TableCell className={`pr-5 text-right tabular ${m.penalty ? "font-bold text-[#a52727]" : "text-muted-foreground"}`}>{m.penalty ? `−${m.penalty}` : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}

export default async function ScorecardPage({ searchParams }: PageProps<"/admin/scorecard">) {
  const profile = await requirePageRole(MANAGERS);
  const sp = await searchParams;
  const filters = parseFilters(sp, "30d");
  const supabase = await createClient();
  const settings = await getSettings(supabase);
  // Branch grades compare every branch, so only org-wide roles see them.
  const orgWide = profile.role === "super_admin" || profile.role === "management";
  const [lookups, { reps, notGraded, branches, managers }] = await Promise.all([
    getLookups(supabase, { profile }),
    getScorecard(supabase, filters, settings.min_employee_sample, { withBranches: orgWide }),
  ]);
  const gradedBranches = (branches ?? []).filter((b) => b.grade !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
  const otherBranches = (branches ?? []).filter((b) => b.grade === null).sort((a, b) => a.name.localeCompare(b.name));
  const branchPdf = new URLSearchParams({ type: "branch_scorecard", format: "pdf", range: "custom", from: filters.from, to: filters.to });
  const managerPdf = new URLSearchParams({ type: "manager_scorecard", format: "pdf", range: "custom", from: filters.from, to: filters.to });

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
        description="Grades each sales rep A+ to Fail from customer feedback, device sales, accessories, conversion and Google reviews. Branch managers are graded 70% on their branch and 30% on their own sales; Management is not graded."
        actions={
          <div className="flex flex-wrap gap-2">
            {orgWide && (
              <>
                <a href={`/api/reports?${managerPdf.toString()}`} className={buttonVariants({ variant: "outline" })}>
                  <Download data-icon="inline-start" /> Manager PDF
                </a>
                <a href={`/api/reports?${branchPdf.toString()}`} className={buttonVariants({ variant: "outline" })}>
                  <Download data-icon="inline-start" /> Branch PDF
                </a>
              </>
            )}
            <a href={`/api/reports?${pdfParams.toString()}`} className={buttonVariants({ variant: "outline" })}>
              <Download data-icon="inline-start" /> Rep PDF
            </a>
          </div>
        }
      />

      <div className="mb-4 flex gap-3 rounded-xl border border-series-1/20 bg-blue-50/60 p-4 text-sm text-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-series-1" />
        <div className="space-y-1.5">
          <p>
            <strong>No targets needed.</strong> Device sales, accessories, conversion rate and Google reviews compare each rep with the average rep in the same showroom for this period: matching the average scores {AVERAGE_SCORE}, a third above average scores 100. Showrooms with fewer than two graded reps compare against the whole company.
          </p>
          <p className="text-muted-foreground">
            Weights: {KPI_KEYS.map((k) => `${KPI_LABELS[k]} ${KPI_WEIGHTS[k]}%`).join(" · ")}. Accessories are scored by sales value (Rs.); commission accessories count {COMMISSION_ACCESSORY_WEIGHT}× their value. Customer feedback = staff rating (60%) + NPS (40%), only with ≥ {settings.min_employee_sample} survey responses. The “What the rep did” ticks are self-reported, so they are shown below for information only and do not change the grade. </p>
          <p className="text-muted-foreground">
            Grades: {GRADE_BANDS.map((b) => (b.grade === "Fail" ? `Fail < ${GRADE_BANDS[GRADE_BANDS.length - 2].min}` : `${b.grade} ≥ ${b.min}`)).join(" · ")}. A rep with fewer than {MIN_GRADED_VISITS} tracked visits in the period is flagged <strong className="text-[#a52727]">Low activity</strong> instead of graded, so the manager can follow up. Only visits recorded with the scorecard fields count; older and imported visits are left out.
          </p>
          <p className="text-muted-foreground">
            <strong className="text-foreground">Fair play:</strong> only Google reviews a manager confirmed (Google Reviews page) count. Conversion is scaled down if a rep records fewer
            customers per working day than the showroom average (“Visits vs showroom”, red below {Math.round(LOW_RECORDING_RATE * 100)}%), so leaving out walk-ins who didn&apos;t buy doesn&apos;t help.
          </p>
          <p className="text-muted-foreground">
            <strong className="text-foreground">Who is graded:</strong> only employees set as <em>Sales rep</em> (Settings → Employees). <em>Branch managers</em>: {MANAGER_WEIGHTS.branch}% branch result (the whole branch compared with the average branch, sales per staff working day) + {MANAGER_WEIGHTS.own}% their own sales (scored like a rep, compared with the branch&apos;s reps), minus their own sudden leave without proof. <em>Management</em> is not graded. Everyone&apos;s visits count in the branch totals.
          </p>
          <p className="text-muted-foreground">
            <strong className="text-foreground">Leave</strong> (Staff Leave page): device sales and accessories are compared per working day, so days off don&apos;t count against a rep.
            Sudden leave <strong className="text-[#a52727]">without proof</strong> takes {LEAVE_PENALTY_PER_DAY} points off the final score per day (at most {MAX_LEAVE_PENALTY}); informed leave and sudden leave with proof cost nothing.
          </p>
        </div>
      </div>

      <FilterBar options={{ branches: lookups.branches, employees: lookups.employees }} values={filters} show={["range", "branch"]} />

      {managers && managers.length > 0 && <ManagerPanel managers={managers} />}
      {branches && <BranchPanel graded={gradedBranches} other={otherBranches} />}

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
                      <TableHead className="text-right whitespace-nowrap" title="Visits recorded per working day ÷ colleagues average">Visits vs showroom</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Days off</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Leave penalty</TableHead>
                      <TableHead className="pr-5">Compared with</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {graded.map((r, i) => (
                      <TableRow key={r.employeeId}>
                        <TableCell className="pl-5 tabular text-muted-foreground">{i + 1}</TableCell>
                        <RepCell r={r} />
                        <TableCell className="text-center"><GradeBadge grade={r.grade} /></TableCell>
                        <TableCell className="text-right font-semibold tabular" title={r.penalty ? `${fmt(r.scoreBeforePenalty, 1)} before the leave penalty` : undefined}>{fmt(r.score, 1)}</TableCell>
                        {KPI_KEYS.map((k) => (
                          <TableCell key={k} className="text-right tabular">{fmt(r.components[k])}</TableCell>
                        ))}
                        <TableCell className={`text-right tabular ${r.recordingRate !== null && r.recordingRate < LOW_RECORDING_RATE ? "font-bold text-[#a52727]" : ""}`} title={r.recordingRate !== null && r.recordingRate < LOW_RECORDING_RATE ? "Records far fewer customers than colleagues – check whether walk-ins are being recorded" : undefined}>
                          {r.recordingRate === null ? "—" : `${Math.round(r.recordingRate * 100)}%`}
                        </TableCell>
                        <TableCell className="text-right tabular" title={`Informed ${r.informedLeaveDays ?? 0} · sudden with proof ${r.excusedSuddenDays ?? 0} · sudden without proof ${r.unexcusedLeaveDays ?? 0}`}>{r.leaveDays ?? 0}</TableCell>
                        <TableCell className={`text-right tabular ${r.penalty ? "font-bold text-[#a52727]" : "text-muted-foreground"}`}>{r.penalty ? `−${r.penalty}` : "—"}</TableCell>
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

          {notGraded.length > 0 && (
            <Panel className="mt-4" title="Not on the rep scorecard" description="Set in Settings → Employees. Their visits still count in the branch totals." bodyClassName="px-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableBody>
                    {notGraded.map((p) => (
                      <TableRow key={p.employeeId}>
                        <TableCell className="pl-5">
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.branchName}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.role === "branch_manager" ? `Branch manager – ${MANAGER_WEIGHTS.branch}% branch + ${MANAGER_WEIGHTS.own}% own sales` : "Management – not graded"}</TableCell>
                        <TableCell className="pr-5 text-right text-sm tabular text-muted-foreground">{p.visits} visits · {p.sales} sales</TableCell>
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
                    <TableHead className="text-right whitespace-nowrap">Commission acc. (Rs.)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Non-comm. acc. (Rs.)</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Days off</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Sudden, no proof</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Avg time with customer</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Avg days to buy</TableHead>
                    <TableHead className="text-right whitespace-nowrap" title="Self-reported by the rep – not graded">Steps ticked (info)</TableHead>
                    <TableHead className="text-right whitespace-nowrap" title="Asked by the rep / confirmed on Google by a manager">Reviews asked / confirmed</TableHead>
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
                      <TableCell className="text-right tabular whitespace-nowrap">{formatLKR(r.commissionAccessoriesValue)}</TableCell>
                      <TableCell className="text-right tabular whitespace-nowrap">{formatLKR(r.nonCommissionAccessoriesValue)}</TableCell>
                      <TableCell className="text-right tabular">{r.leaveDays ?? 0}</TableCell>
                      <TableCell className={`text-right tabular ${r.unexcusedLeaveDays ? "font-bold text-[#a52727]" : ""}`}>{r.unexcusedLeaveDays ?? 0}</TableCell>
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
