import type { Metadata } from "next";
import { CalendarOff, Info } from "lucide-react";
import { MANAGERS, requirePageRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseFilters } from "@/lib/analytics/filters";
import { formatDate, todayColombo } from "@/lib/format";
import { LEAVE_PENALTY_PER_DAY, MAX_LEAVE_PENALTY, leavePenalty } from "@/lib/kpi";
import { listLeave } from "@/server/services/leave";
import { getLookups } from "@/server/services/lookups";
import { PageHeader } from "@/components/admin/page-header";
import { FilterBar } from "@/components/admin/filter-bar";
import { Panel } from "@/components/admin/panel";
import { EmptyState } from "@/components/admin/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteLeaveButton, ProofButton, RecordLeaveDialog } from "./leave-actions";

export const metadata: Metadata = { title: "Staff leave" };

function TypeBadge({ type, proof }: { type: string; proof: boolean }) {
  if (type === "informed") return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Informed in advance</span>;
  if (proof) return <span className="rounded-full bg-promoter-soft px-2 py-0.5 text-xs font-medium text-[#087a08]">Sudden – proof received</span>;
  return <span className="rounded-full bg-detractor-soft px-2 py-0.5 text-xs font-bold text-[#a52727]">Sudden – no proof</span>;
}

export default async function LeavePage({ searchParams }: PageProps<"/admin/leave">) {
  const profile = await requirePageRole(MANAGERS);
  const sp = await searchParams;
  const filters = parseFilters(sp, "30d");
  const supabase = await createClient();
  const [lookups, rows] = await Promise.all([getLookups(supabase, { profile }), listLeave(supabase, filters)]);

  const summary = new Map<string, { name: string; branch: string; informed: number; proof: number; noProof: number }>();
  for (const r of rows) {
    const s = summary.get(r.employee_id) ?? { name: r.employees?.full_name ?? "—", branch: r.branches?.name ?? "", informed: 0, proof: 0, noProof: 0 };
    if (r.leave_type === "informed") s.informed++;
    else if (r.proof_received) s.proof++;
    else s.noProof++;
    summary.set(r.employee_id, s);
  }
  // A branch manager's own leave lowers their branch grade, so only Management / Super Admin manage it.
  const isBM = profile.role === "branch_manager";
  const managementOnly = (employeeId: string, role: string | undefined) => isBM && (role === "branch_manager" || employeeId === profile.employee_id);
  const recordable = isBM ? lookups.employees.filter((e) => !managementOnly(e.id, e.scorecard_role)) : lookups.employees;
  const people = [...summary.values()].sort((a, b) => b.noProof - a.noProof || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Staff leave"
        description="Days off per sales rep and branch manager. Sudden leave without proof lowers the grade (a branch manager’s lowers the branch grade); all days off lower what is expected to be sold."
        actions={<RecordLeaveDialog employees={recordable} branches={lookups.branches} today={todayColombo()} />}
      />
      <div className="mb-4 flex gap-3 rounded-xl border border-series-1/20 bg-blue-50/60 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-series-1" />
        <p>
          <strong>Informed in advance</strong> and <strong>sudden leave with proof</strong> (e.g. a medical certificate): no penalty.{" "}
          <strong className="text-[#a52727]">Sudden leave without proof</strong>: −{LEAVE_PENALTY_PER_DAY} points per day on the final score (at most −{MAX_LEAVE_PENALTY} per period).
          If the rep brings proof later, click <strong>Proof received</strong> and the penalty is removed. Keep the documents in the HR file – don&apos;t write medical details here.
        </p>
      </div>
      <div className="-mt-2 mb-4 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Branch managers:</strong> the same rules apply, and their sudden leave without proof lowers the <strong className="text-foreground">branch grade</strong>. Only Management or a Super Admin can record or change a branch manager&apos;s leave – a branch manager cannot record their own.
      </div>
      <FilterBar options={{ branches: lookups.branches, employees: lookups.employees }} values={filters} show={["range", "branch", "employee"]} defaultRange="30d" />

      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon={CalendarOff} title="No leave recorded in this period" description="Use “Record leave” when a sales rep is off." />
        </Panel>
      ) : (
        <>
          <Panel title="Per person" description="Days off in this period and the effect on the grade." bodyClassName="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-5">Employee</TableHead>
                    <TableHead className="text-right">Informed</TableHead>
                    <TableHead className="text-right">Sudden – proof</TableHead>
                    <TableHead className="text-right">Sudden – no proof</TableHead>
                    <TableHead className="pr-5 text-right">Grade penalty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.map((p) => (
                    <TableRow key={p.name + p.branch}>
                      <TableCell className="pl-5"><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.branch}</p></TableCell>
                      <TableCell className="text-right tabular">{p.informed}</TableCell>
                      <TableCell className="text-right tabular">{p.proof}</TableCell>
                      <TableCell className={`text-right tabular ${p.noProof ? "font-bold text-[#a52727]" : ""}`}>{p.noProof}</TableCell>
                      <TableCell className={`pr-5 text-right tabular ${p.noProof ? "font-bold text-[#a52727]" : "text-muted-foreground"}`}>{p.noProof ? `−${leavePenalty(p.noProof)} points` : "None"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
          <Panel className="mt-4" title="Leave days" bodyClassName="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="pl-5">Date</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Recorded by</TableHead>
                    <TableHead className="pr-5 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-5 whitespace-nowrap">{formatDate(r.leave_date, "EEE d MMM yyyy")}</TableCell>
                      <TableCell><p className="font-medium">{r.employees?.full_name ?? "—"}</p><p className="text-xs text-muted-foreground">{r.branches?.name}</p></TableCell>
                      <TableCell><TypeBadge type={r.leave_type} proof={r.proof_received} /></TableCell>
                      <TableCell className="max-w-72 text-sm text-muted-foreground">{r.note ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.profiles?.full_name ?? "—"}</TableCell>
                      <TableCell className="pr-5">
                        <div className="flex justify-end gap-1">
                          {managementOnly(r.employee_id, r.employees?.scorecard_role) ? (
                            <span className="text-xs text-muted-foreground">Management only</span>
                          ) : (
                            <>
                              {r.leave_type === "sudden" && <ProofButton id={r.id} proof={r.proof_received} />}
                              <DeleteLeaveButton id={r.id} />
                            </>
                          )}
                        </div>
                      </TableCell>
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
