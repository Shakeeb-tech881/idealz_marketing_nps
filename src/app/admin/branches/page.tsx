import type { Metadata } from "next";
import { AlertTriangle, Store } from "lucide-react";
import { MANAGERS, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/analytics/filters";
import { formatNps } from "@/lib/nps";
import { formatDate, formatPct, formatRating } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { getBranchPerformance, getComplaintThemesByBranch, getTrend } from "@/server/services/analytics";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { FilterBar } from "@/components/admin/filter-bar";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { SampleBadge } from "@/components/admin/badges";
import { NpsTrendChart, SegmentNpsChart } from "@/components/charts/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Branch analytics" };

export default async function BranchesPage({ searchParams }: PageProps<"/admin/branches">) {
  const profile = await requirePageRole(MANAGERS);
  const sp = await searchParams;
  const filters = parseFilters(sp, "90d");
  const supabase = await createClient();
  const settings = await getSettings(supabase);
  const min = settings.min_branch_sample;
  const [lookups, rows, complaints, trend] = await Promise.all([
    getLookups(supabase, { profile }),
    getBranchPerformance(supabase, { ...filters, branch: null }),
    getComplaintThemesByBranch(supabase, { ...filters, branch: null }),
    getTrend(supabase, filters, "month"),
  ]);
  const visible = filters.branch ? rows.filter((r) => r.branchId === filters.branch) : rows;
  const needsAttention = visible.filter((b) => b.nps.total >= min && b.nps.nps !== null).sort((a, b) => (a.nps.nps ?? 0) - (b.nps.nps ?? 0)).slice(0, 3);
  const branchName = filters.branch ? lookups.branches.find((b) => b.id === filters.branch)?.name : null;

  return (
    <>
      <PageHeader title="Branch performance" description={`Compare customer experience across branches. Branches with fewer than ${min} responses are flagged as low sample and should not be compared directly.`} />
      <FilterBar options={{ branches: lookups.branches, employees: lookups.employees }} values={filters} show={["range", "branch", "type", "category"]} />

      {visible.length === 0 ? (
        <Panel><EmptyState icon={Store} title="No branches yet" description="Add branches in Settings." /></Panel>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            <Panel className="xl:col-span-2" title="NPS by branch" description="Faded bars = low sample">
              <SegmentNpsChart data={visible.map((b) => ({ name: b.name, nps: b.nps.nps, n: b.nps.total, reliable: b.nps.total >= min }))} />
            </Panel>
            <Panel title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-passive" /> Needs attention</span>} description={`Lowest NPS among branches with ≥ ${min} responses`}>
              {needsAttention.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No branch has enough responses yet.</p>
              ) : (
                <ul className="space-y-3">
                  {needsAttention.map((b) => {
                    const c = complaints.get(b.branchId);
                    return (
                      <li key={b.branchId} className="rounded-lg border border-border p-3">
                        <div className="flex items-baseline justify-between">
                          <p className="font-medium">{b.name}</p>
                          <p className="text-lg font-semibold tabular">{formatNps(b.nps.nps)}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">{b.nps.detractors} detractors · staff {formatRating(b.avgStaffRating)} / 5</p>
                        {c && c.themes.length > 0 && <p className="mt-1 text-xs">Common complaints: {c.themes.map((t) => t.label).join(", ")}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          <Panel className="mt-4" title="Branch comparison" bodyClassName="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-5">Branch</TableHead>
                    <TableHead className="text-right">Invited</TableHead>
                    <TableHead className="text-right" title="Only where the SMS provider reports delivery">Delivered*</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Response rate</TableHead>
                    <TableHead className="text-right">NPS</TableHead>
                    <TableHead className="text-right">Promoters</TableHead>
                    <TableHead className="text-right">Passives</TableHead>
                    <TableHead className="text-right">Detractors</TableHead>
                    <TableHead className="text-right">Staff rating</TableHead>
                    <TableHead className="text-right">Purchased NPS</TableHead>
                    <TableHead className="text-right">Non-purch. NPS</TableHead>
                    <TableHead className="pr-5">Common complaints</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((b) => {
                    const c = complaints.get(b.branchId);
                    return (
                      <TableRow key={b.branchId}>
                        <TableCell className="pl-5">
                          <p className="font-medium">{b.name}</p>
                          <SampleBadge n={b.nps.total} min={min} />
                        </TableCell>
                        <TableCell className="text-right tabular">{b.invited}</TableCell>
                        <TableCell className="text-right tabular text-muted-foreground">{b.delivered || "—"}</TableCell>
                        <TableCell className="text-right tabular">{b.completed}</TableCell>
                        <TableCell className="text-right tabular">{formatPct(b.responseRate)}</TableCell>
                        <TableCell className="text-right text-base font-semibold tabular">{formatNps(b.nps.nps)}</TableCell>
                        <TableCell className="text-right tabular">{formatPct(b.nps.promoterPct)}</TableCell>
                        <TableCell className="text-right tabular">{formatPct(b.nps.passivePct)}</TableCell>
                        <TableCell className="text-right tabular">{formatPct(b.nps.detractorPct)} <span className="text-xs text-muted-foreground">({b.nps.detractors})</span></TableCell>
                        <TableCell className="text-right tabular">{formatRating(b.avgStaffRating)}</TableCell>
                        <TableCell className="text-right tabular">{formatNps(b.purchased.nps)} <span className="text-xs text-muted-foreground">({b.purchased.total})</span></TableCell>
                        <TableCell className="text-right tabular">{formatNps(b.nonPurchased.nps)} <span className="text-xs text-muted-foreground">({b.nonPurchased.total})</span></TableCell>
                        <TableCell className="max-w-56 pr-5 text-xs whitespace-normal text-muted-foreground">{c?.themes.length ? c.themes.map((t) => `${t.label} (${t.total})`).join(", ") : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="px-5 py-3 text-xs text-muted-foreground">*Delivered counts only appear when the SMS provider supplies delivery reports. Response rate = completed ÷ SMS sent.</p>
          </Panel>

          <Panel className="mt-4" title={`Monthly trend · ${branchName ?? "all branches shown"}`} description="Select a branch in the filter to see its own trend">
            <NpsTrendChart data={trend.map((t) => ({ ...t, label: formatDate(t.period, "MMM yy") }))} segments={!filters.surveyType} />
          </Panel>
        </>
      )}
    </>
  );
}
