import type { Metadata } from "next";
import { Info, UserRoundCheck } from "lucide-react";
import { MANAGERS, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/analytics/filters";
import { formatNps } from "@/lib/nps";
import { formatRating } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getEmployeePerformance } from "@/server/services/analytics";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { FilterBar } from "@/components/admin/filter-bar";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EmployeePerf } from "@/server/services/analytics";

export const metadata: Metadata = { title: "Employee analytics" };

function Rows({ rows, ranked }: { rows: EmployeePerf[]; ranked: boolean }) {
  return (
    <>
      {rows.map((e, i) => (
        <TableRow key={e.employeeId}>
          <TableCell className="pl-5 tabular text-muted-foreground">{ranked ? i + 1 : "—"}</TableCell>
          <TableCell>
            <p className="font-medium">{e.name}{!e.isActive && <span className="ml-2 text-[10px] text-muted-foreground uppercase">Inactive</span>}</p>
            <p className="text-xs text-muted-foreground">{e.branchName}</p>
          </TableCell>
          <TableCell className="text-right tabular">{e.interactions}</TableCell>
          <TableCell className="text-right tabular">{e.nps.total}</TableCell>
          <TableCell className="text-right font-semibold tabular">{formatRating(e.avgStaffRating)}</TableCell>
          <TableCell className="text-right tabular">{ranked ? formatNps(e.nps.nps) : <span className="text-muted-foreground">{formatNps(e.nps.nps)}</span>}</TableCell>
          <TableCell className="text-right tabular">{e.nps.promoters}</TableCell>
          <TableCell className="text-right tabular">{e.nps.passives}</TableCell>
          <TableCell className="text-right tabular">{e.nps.detractors}</TableCell>
          <TableCell className="text-right tabular text-[#087a08]">{e.positiveComments}</TableCell>
          <TableCell className="pr-5 text-right tabular text-[#a52727]">{e.negativeComments}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default async function EmployeesPage({ searchParams }: PageProps<"/admin/employees">) {
  const profile = await requirePageRole(MANAGERS);
  const sp = await searchParams;
  const filters = parseFilters(sp, "90d");
  const supabase = await createClient();
  const settings = await getSettings(supabase);
  const min = settings.min_employee_sample;
  const [lookups, rows] = await Promise.all([getLookups(supabase, { profile }), getEmployeePerformance(supabase, filters, min)]);

  const ranked = rows.filter((r) => r.sufficientSample).sort((a, b) => (b.avgStaffRating ?? 0) - (a.avgStaffRating ?? 0) || (b.nps.nps ?? -101) - (a.nps.nps ?? -101));
  const unranked = rows.filter((r) => !r.sufficientSample).sort((a, b) => b.nps.total - a.nps.total || a.name.localeCompare(b.name));

  const head = (
    <TableHeader>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableHead className="w-12 pl-5">Rank</TableHead>
        <TableHead>Employee</TableHead>
        <TableHead className="text-right">Interactions</TableHead>
        <TableHead className="text-right">Feedback</TableHead>
        <TableHead className="text-right">Avg staff rating</TableHead>
        <TableHead className="text-right">Associated NPS</TableHead>
        <TableHead className="text-right">Promoters</TableHead>
        <TableHead className="text-right">Passives</TableHead>
        <TableHead className="text-right">Detractors</TableHead>
        <TableHead className="text-right">Positive comments</TableHead>
        <TableHead className="pr-5 text-right">Negative comments</TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <>
      <PageHeader title="Employee service quality" description="Customer feedback linked to the employee who served each customer." />
      <div className="mb-4 flex gap-3 rounded-xl border border-series-1/20 bg-blue-50/60 p-4 text-sm text-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-series-1" />
        <div className="space-y-1">
          <p>
            <strong>Read with care.</strong> Associated NPS reflects how customers served by an employee feel about iDealz Lanka overall (price, stock, product) — it is an indicator, not a direct measure of individual performance. The staff service rating is the most direct measure.
          </p>
          <p className="text-muted-foreground">Employees are ranked only when they have at least {min} responses (configurable in Settings). A low response count is not a negative result.</p>
        </div>
      </div>
      <FilterBar options={{ branches: lookups.branches, employees: lookups.employees }} values={filters} show={["range", "branch", "type", "category"]} />
      {rows.length === 0 ? (
        <Panel><EmptyState icon={UserRoundCheck} title="No employees yet" description="Add employees in Settings and link them to customer records." /></Panel>
      ) : (
        <>
          <Panel title="Ranked employees" description={`Sufficient sample (≥ ${min} responses) · ranked by average staff service rating`} bodyClassName="px-0 pb-0">
            {ranked.length === 0 ? (
              <EmptyState title="No employee has enough responses to be ranked yet" />
            ) : (
              <div className="overflow-x-auto"><Table>{head}<TableBody><Rows rows={ranked} ranked /></TableBody></Table></div>
            )}
          </Panel>
          <Panel className="mt-4" title="Insufficient sample — not ranked" description={`Fewer than ${min} responses in this period`} bodyClassName="px-0 pb-0">
            {unranked.length === 0 ? (
              <EmptyState title="Every employee has a sufficient sample" />
            ) : (
              <div className="overflow-x-auto"><Table>{head}<TableBody><Rows rows={unranked} ranked={false} /></TableBody></Table></div>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
